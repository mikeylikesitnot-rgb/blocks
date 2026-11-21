import { useEffect, useId, useRef, useState } from 'react';
import { cx } from './cx.js';
import { Segmented } from './Layout.jsx';
import { useTheme } from './theme.js';
import { MenuIcon, XIcon, SunIcon, MoonIcon, PanelLeftIcon } from './icons.jsx';

import { SHELL_OPEN_EVENT as SHELL_OPEN } from './NavMenu.jsx';
import { NavCount } from './NavCount.jsx';

/**
 * App frame with a sidebar on the left (desktop) that becomes a slide-out
 * menu behind a top bar on phones. Picking a nav item closes the menu.
 *   <SidebarLayout brand="Project Hub" sidebar={<NavList … />} footer={<ThemeSwitch />}>
 *     …page…
 *   </SidebarLayout>
 * Height defaults to the viewport; set --mk-shell-h to embed it in a box.
 *
 * `collapsible` adds a Hide menu button on desktop: the sidebar then works
 * like the phone menu (☰ opens it over the page, picking a page closes it),
 * and Keep menu open pins it again. Pass `pinned` + `onPinnedChange` to save
 * the choice; otherwise it starts at `defaultPinned`. Like the phone menu, the
 * slide-out covers the window, so it suits a layout that fills the window.
 *
 * `resizable` adds a handle on the desktop sidebar's right edge: drag it (or
 * focus it and press ← / →) to set the width between `minWidth` and
 * `maxWidth`; double-click or Enter goes back to the default. Pass
 * `sidebarWidth` + `onSidebarWidthChange` to save it (null = the default
 * --mk-sidebar-w); it is reported once per drag, when the drag ends.
 *
 * A "Skip to content" link comes first in the tab order and jumps past the
 * menu to the page. `skipLabel` renames it; `skipLabel={null}` removes it.
 */
export function SidebarLayout({
  brand, sidebar, footer, children, label = 'Main', className = '', style,
  collapsible = false, pinned: pinnedProp, defaultPinned = true, onPinnedChange,
  resizable = false, sidebarWidth: widthProp, defaultSidebarWidth = null, onSidebarWidthChange,
  minWidth = 200, maxWidth = 400, skipLabel = 'Skip to content',
}) {
  const mainId = useId();
  const [widthState, setWidthState] = useState(defaultSidebarWidth);
  const [dragWidth, setDragWidth] = useState(null); // live width while dragging
  const savedWidth = widthProp === undefined ? widthState : widthProp;
  const clampW = (w) => Math.round(Math.min(maxWidth, Math.max(minWidth, w)));
  const width = resizable ? (dragWidth ?? (Number.isFinite(savedWidth) ? clampW(savedWidth) : null)) : null;
  const commitWidth = (w) => {
    const next = w == null ? null : clampW(w);
    if (widthProp === undefined) setWidthState(next);
    onSidebarWidthChange?.(next);
  };
  const [open, setOpen] = useState(false);
  const [pinnedState, setPinnedState] = useState(defaultPinned);
  const pinned = !collapsible || (pinnedProp ?? pinnedState);
  const setPinned = (next) => {
    if (pinnedProp === undefined) setPinnedState(next);
    onPinnedChange?.(next);
    setOpen(false);
    // Hiding takes the sidebar away: hand focus to ☰. Pinning keeps the button where it is.
    if (!next) setTimeout(() => menuBtn.current?.focus(), 0);
  };
  // `pinned` turned true from outside while the slide-out was open (a saved
  // choice arriving late): close it, or inert would stay on the page.
  const [prevPinned, setPrevPinned] = useState(pinned);
  if (prevPinned !== pinned) {
    setPrevPinned(pinned);
    if (pinned && open && !window.matchMedia?.('(max-width: 859px)').matches) setOpen(false);
  }
  const isDrawer = () => !pinned || window.matchMedia?.('(max-width: 859px)').matches;
  const sideRef = useRef(null);
  const menuBtn = useRef(null);

  const barRef = useRef(null);
  const mainRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // While the phone menu is open, the page behind it can't be tabbed into.
    // Set as a DOM attribute: React 18 and 19 disagree on the `inert` prop.
    const behind = [barRef.current, mainRef.current].filter(Boolean);
    behind.forEach((el) => el.setAttribute('inert', ''));
    // Focus the drawer (NavMenu's shortcut moves focus on to its search a moment later).
    if (!sideRef.current?.contains(document.activeElement)) sideRef.current?.focus();
    // Esc the search box already used (to clear it) doesn't also close the menu.
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      behind.forEach((el) => el.removeAttribute('inert'));
      // Focus was in the drawer, which is now hidden: hand it back to the menu button.
      const a = document.activeElement;
      if (!a || a === document.body || sideRef.current?.contains(a)) menuBtn.current?.focus();
    };
  }, [open]);

  // Widening a phone-size window past 860px with the menu open would leave a
  // pinned sidebar next to an inert page: close the slide-out instead.
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 859px)');
    if (!mq || !pinned) return undefined;
    const onChange = (e) => { if (!e.matches) setOpen(false); };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [pinned]);

  // NavMenu's ⌘K / "/" shortcut asks for the phone menu so its search can take focus.
  useEffect(() => {
    const onOpen = () => { if (isDrawer()) setOpen(true); };
    window.addEventListener(SHELL_OPEN, onOpen);
    return () => window.removeEventListener(SHELL_OPEN, onOpen);
  }, [pinned]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentWidth = () => width ?? sideRef.current?.getBoundingClientRect().width ?? minWidth;
  // The drag reads the latest props (a parent re-rendering mid-drag with a new
  // callback or bounds must not get the stale one at drag end).
  const latest = useRef({});
  latest.current = { clampW, commitWidth };
  const endDrag = useRef(null); // set while a drag is in progress
  const movedAt = useRef(0);    // when the last drag that moved the edge ended
  useEffect(() => () => endDrag.current?.(true), []); // unmounted mid-drag: undo the page-wide cursor
  const startResize = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    endDrag.current?.(true);
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startW = currentWidth();
    let last = startW;
    handle.setPointerCapture?.(e.pointerId);
    document.documentElement.classList.add('mk-shell-resizing');
    const move = (ev) => { last = latest.current.clampW(startW + ev.clientX - startX); setDragWidth(last); };
    const end = (unmounting) => {
      endDrag.current = null;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      handle.removeEventListener('lostpointercapture', onEnd);
      document.documentElement.classList.remove('mk-shell-resizing');
      if (unmounting === true) return;
      setDragWidth(null);
      if (last !== startW) { movedAt.current = Date.now(); latest.current.commitWidth(last); }
    };
    const onEnd = () => end(false);
    endDrag.current = end;
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
    handle.addEventListener('lostpointercapture', onEnd);
  };
  // A quick second drag fires dblclick too: only reset when the edge didn't just move.
  const onResizeDoubleClick = () => { if (Date.now() - movedAt.current > 600) commitWidth(null); };
  const onResizeKey = (e) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      commitWidth(currentWidth() + (e.key === 'ArrowRight' ? step : -step));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      commitWidth(e.key === 'Home' ? minWidth : maxWidth);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitWidth(null);
    }
  };
  // With no width set, the separator still reports the width shown (the CSS default).
  const [shownWidth, setShownWidth] = useState(null);
  useEffect(() => {
    if (!resizable || width != null) return;
    const w = sideRef.current?.getBoundingClientRect().width;
    if (w) setShownWidth(Math.round(w));
  }, [resizable, width, pinned]);
  const shellStyle = width != null ? { ...style, '--mk-sidebar-w': `${width}px` } : style;

  // Any nav item click closes the slide-out menu; a pinned desktop sidebar ignores `open`.
  const onSideClick = (e) => { if (open && e.target.closest?.('.mk-nav-item')) setOpen(false); };

  return (
    <div className={cx('mk-shell', open && 'mk-shell-open', !pinned && 'mk-shell-unpinned', resizable && 'mk-shell-resizable', className)} style={shellStyle}>
      {skipLabel && (
        <a
          href={`#${mainId}`}
          className="mk-skip-link"
          onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}
        >
          {skipLabel}
        </a>
      )}
      <div ref={barRef} className="mk-shell-bar">
        <button ref={menuBtn} type="button" className="mk-shell-menu" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <MenuIcon />
        </button>
        {brand && <div className="mk-shell-brand">{brand}</div>}
      </div>
      <div className="mk-shell-backdrop" onClick={() => setOpen(false)} aria-hidden />
      <aside ref={sideRef} tabIndex={-1} className="mk-shell-side" aria-label={label} onClick={onSideClick}>
        <div className="mk-shell-side-head">
          {brand && <div className="mk-shell-brand">{brand}</div>}
          {collapsible && (
            <button
              type="button"
              className="mk-shell-pin"
              aria-label={pinned ? 'Hide menu' : 'Keep menu open'}
              title={pinned ? 'Hide menu' : 'Keep menu open'}
              onClick={() => setPinned(!pinned)}
            >
              <PanelLeftIcon />
            </button>
          )}
          <button type="button" className="mk-shell-close" aria-label="Close menu" onClick={() => setOpen(false)}>
            <XIcon />
          </button>
        </div>
        <div className="mk-shell-nav">{sidebar}</div>
        {footer && <div className="mk-shell-foot">{footer}</div>}
      </aside>
      {resizable && pinned && (
        <div
          className="mk-shell-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize menu"
          title="Drag to resize · double-click to reset"
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={Math.round(width ?? shownWidth ?? minWidth)}
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={onResizeDoubleClick}
          onKeyDown={onResizeKey}
        />
      )}
      <main ref={mainRef} id={mainId} tabIndex={-1} className="mk-shell-main">{children}</main>
    </div>
  );
}

/**
 * Sidebar list. Items are buttons (or links with href); `section` entries are
 * headings. The selected item gets aria-current.
 *   <NavList value={slug} onChange={setSlug} items={[
 *     { value: '', label: 'All projects', icon: <InitialIcon tone="ink">✱</InitialIcon>, count: 42 },
 *     { section: 'Projects', count: 9 },
 *     { value: 'kit', label: 'Blocks', icon: <InitialIcon name="Blocks" color={2} />, count: '2 building', hot: true, note: '2 features being built' },
 *   ]} />
 */
export function NavList({ items, value, onChange, label, className = '' }) {
  return (
    <nav className={cx('mk-nav', className)} aria-label={label}>
      {items.map((it, i) => {
        if (it.section != null) {
          return (
            <div key={`s-${i}`} className="mk-nav-section">
              <span>{it.section}</span>
              {it.count != null && <span className="mk-tabular">{it.count}</span>}
            </div>
          );
        }
        const current = it.value === value;
        const Tag = it.href ? 'a' : 'button';
        return (
          <Tag
            key={it.value ?? i}
            type={it.href ? undefined : 'button'}
            href={it.href}
            className="mk-nav-item"
            aria-current={current ? 'page' : undefined}
            onClick={(e) => { it.onClick?.(e); if (!it.onClick && onChange) onChange(it.value); }}
          >
            {it.icon}
            <span className="mk-nav-label">{it.label}</span>
            <NavCount it={it} />
          </Tag>
        );
      })}
    </nav>
  );
}

/** Two capitals of a name ("Project Hub" → "PH"), else its first two letters. */
export function initials(name = '') {
  const caps = String(name).match(/[A-Z]/g);
  if (caps && caps.length) return caps.slice(0, 2).join('');
  return String(name).replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
}

/**
 * Small coloured square with initials, for projects, teams or workspaces.
 * `color` picks one of 8 category colours (any integer; it wraps).
 *   <InitialIcon name="Project Hub" color={3} />      <InitialIcon tone="ink">✱</InitialIcon>
 */
export function InitialIcon({ name, color = 0, tone, size = 'sm', children, className = '' }) {
  const n = ((Math.trunc(Number(color) || 0) % 8) + 8) % 8 + 1;
  return (
    <span
      aria-hidden
      className={cx('mk-initial', size === 'md' && 'mk-initial-md', tone && `mk-initial-${tone}`, className)}
      style={tone ? undefined : { background: `var(--mk-cat-${n})` }}
    >
      {children ?? initials(name)}
    </span>
  );
}

/** Auto / Light / Dark switch for a sidebar footer or settings page. */
export function ThemeSwitch({ className = '', icons = false }) {
  const [theme, setTheme] = useTheme();
  return (
    <Segmented
      label="Appearance"
      className={cx('mk-theme-switch', className)}
      value={theme}
      onChange={setTheme}
      items={[
        { value: 'system', label: 'Auto' },
        { value: 'light', label: 'Light', icon: icons ? SunIcon : undefined },
        { value: 'dark', label: 'Dark', icon: icons ? MoonIcon : undefined },
      ]}
    />
  );
}
