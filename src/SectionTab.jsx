import { useEffect, useRef, useState } from 'react';
import { Button } from './Button.jsx';
import { ArrowUpIcon, ArrowDownIcon, ChevronRightIcon, GripIcon, XIcon } from './icons.jsx';
import { motionOk } from './motion.js';

/*
 * Section menu for a long page on a phone. A small tab on the left edge of the screen stays in
 * view while the page scrolls and shows the icon of the section being read (plus a red/amber dot
 * when a section has one). Tapping it opens a side panel with the full names: tap one to jump
 * there; optional Fold all / Open all and Reorder (drag the grip or use the arrows).
 * Hidden from 1024px up, where a page usually shows everything; from 860px, beside Blocks'
 * pinned sidebar instead of on top of it. Esc, the backdrop and ✕ close the panel.
 *
 *   <SectionTab items={[{ id: 'sec-vehicle', label: 'Vehicle', icon: CarIcon }, ...]} />
 *
 * items:      [{ id, label, icon, dot?: 'red' | 'amber', meta?: string }] in page order;
 *             id is the section element's id (the page scrolls to it).
 * onJump(id): called before scrolling, e.g. to open a folded section.
 * onReorder(ids, { persist }): shows Reorder; persist false while a drag is still moving.
 * onFoldAll(fold): shows Fold all / Open all.
 * title:      panel heading and the tab's name (default "Sections").
 * offset:     px kept clear above a section when jumping (sticky bars); default 0, CSS scroll-margin
 *             on the sections works too.
 */

const DOT_LABEL = { red: 'expired', amber: 'due soon' };

/* The section being read: the last one whose top has passed the upper third of the screen, or the
   last section once the page is scrolled to the bottom. `ids` joined with '|'. */
export function useCurrentSection(ids) {
  const [current, setCurrent] = useState(ids.split('|')[0]);
  const lockUntil = useRef(0);          // after a jump, the chosen section stays current while the page scrolls there
  useEffect(() => {
    const els = ids.split('|').map((id) => document.getElementById(id)).filter(Boolean);
    if (!els.length) return undefined;
    const pick = () => {
      if (Date.now() < lockUntil.current) return;
      const line = Math.max(140, window.innerHeight * 0.3);
      let cur = els[0].id;
      for (const el of els) if (el.getBoundingClientRect().top <= line) cur = el.id;
      const last = els[els.length - 1].getBoundingClientRect();
      if (last.bottom <= window.innerHeight + 2 && last.top < window.innerHeight) cur = els[els.length - 1].id;
      setCurrent(cur);
    };
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(pick, { rootMargin: '-120px 0px 0px 0px', threshold: [0, 1] })
      : null;
    els.forEach((el) => io?.observe(el));
    window.addEventListener('scroll', pick, { passive: true, capture: true });
    pick();
    return () => { io?.disconnect(); window.removeEventListener('scroll', pick, { capture: true }); };
  }, [ids]);
  const lock = (id) => { setCurrent(id); lockUntil.current = Date.now() + 1000; };
  return [current, lock];
}

export function SectionTab({ items, onJump, onReorder, onFoldAll, title = 'Sections', offset = 0, className = '' }) {
  const ids = items.map((i) => i.id).join('|');
  const [current, lock] = useCurrentSection(ids);
  const [open, setOpen] = useState(false);
  const cur = items.find((i) => i.id === current) || items[0];
  const CurIcon = cur?.icon;
  // A dot on any section shows on the tab too, so it isn't hidden while the panel is shut.
  const alert = items.some((i) => i.dot === 'red') ? 'red' : items.some((i) => i.dot === 'amber') ? 'amber' : undefined;
  const alertItem = alert && items.find((i) => i.dot === alert);

  const jump = (id) => {
    onJump?.(id);
    lock(id);
    // After a folded section has had a frame to open.
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const behavior = motionOk() ? 'smooth' : 'auto';
      if (offset) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior });
      else el.scrollIntoView({ behavior, block: 'start' });
    });
  };

  if (!items.length) return null;
  return (
    <>
      <button
        type="button"
        className={`mk-sectab ${className}`}
        onClick={() => setOpen(true)}
        aria-label={`${title}${cur ? `, now ${cur.label}` : ''}${alertItem ? `, ${alertItem.label} ${DOT_LABEL[alert]}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {CurIcon && <CurIcon className="mk-sectab-icon" aria-hidden />}
        <ChevronRightIcon className="mk-sectab-chev" />
        {alert && <span className={`mk-sectab-dot mk-sectab-dot-${alert}`} aria-hidden />}
      </button>
      {open && (
        <SectionPanel
          items={items}
          current={current}
          title={title}
          onClose={() => setOpen(false)}
          onJump={(id) => { setOpen(false); jump(id); }}
          onReorder={onReorder}
          onFoldAll={onFoldAll && ((fold) => { setOpen(false); onFoldAll(fold); })}
        />
      )}
    </>
  );
}

function SectionPanel({ items, current, title, onClose, onJump, onReorder, onFoldAll }) {
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState(null);
  const panelRef = useRef(null);
  const orderRef = useRef(items.map((i) => i.id));
  orderRef.current = items.map((i) => i.id);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Once, on open: focus the first button, Esc closes, Tab stays inside; focus goes back on close.
  useEffect(() => {
    const prev = document.activeElement;
    panelRef.current?.querySelector('button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = [...panelRef.current.querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      if (!panelRef.current.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); return; }
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    // From 1024px the CSS hides the panel; close it so the focus trap doesn't stay on (rotation, resize).
    const wide = window.matchMedia?.('(min-width: 1024px)');
    const onWide = () => { if (wide.matches) closeRef.current(); };
    wide?.addEventListener?.('change', onWide);
    if (wide?.matches) onWide();
    return () => { document.removeEventListener('keydown', onKey); wide?.removeEventListener?.('change', onWide); prev?.focus?.(); };
  }, []);

  const move = (id, by) => {
    const next = [...orderRef.current];
    const i = next.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= next.length) return;
    next.splice(i, 1);
    next.splice(j, 0, id);
    orderRef.current = next;            // a second quick tap starts from here
    onReorder(next, { persist: true });
    // At either end that arrow turns off; keep focus on the row's other arrow, inside the panel.
    if (j === 0 || j === next.length - 1) {
      requestAnimationFrame(() => panelRef.current?.querySelector(`[data-move="${id}:${by > 0 ? -1 : 1}"]`)?.focus());
    }
  };

  // Drag by the grip: each row-height of travel moves the section one place. Listens on window,
  // since the row moves in the list while the finger is down.
  const stopDrag = useRef(null);
  const dragBefore = useRef(null);      // the order when the current drag started
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;
  // Panel closed mid-drag: stop listening, and save an order the drag already showed.
  useEffect(() => () => {
    if (!stopDrag.current) return;
    stopDrag.current();
    if (orderRef.current.join('|') !== dragBefore.current) reorderRef.current?.(orderRef.current, { persist: true });
  }, []);
  const startDrag = (e, id) => {
    e.preventDefault();
    const before = orderRef.current.join('|');
    dragBefore.current = before;
    const row = e.currentTarget.closest('li');
    const step = (row?.offsetHeight || 48) + 4;
    let startY = e.clientY;
    setDragId(id);
    const onMove = (ev) => {
      const by = Math.trunc((ev.clientY - startY) / step);
      if (!by) return;
      const next = [...orderRef.current];
      const i = next.indexOf(id);
      const j = Math.max(0, Math.min(next.length - 1, i + by));
      if (j === i) return;
      next.splice(i, 1);
      next.splice(j, 0, id);
      startY += (j - i) * step;
      orderRef.current = next;
      onReorder(next, { persist: false });
    };
    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      stopDrag.current = null;
    };
    const onUp = () => {
      detach();
      setDragId(null);
      if (orderRef.current.join('|') !== before) onReorder(orderRef.current, { persist: true });   // a tap on the grip saves nothing
    };
    stopDrag.current = detach;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div className="mk-sectab-root">
      <button type="button" tabIndex={-1} aria-label={`Close ${title.toLowerCase()} menu`} className="mk-sectab-backdrop" onClick={onClose} />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className="mk-sectab-panel">
        <div className="mk-sectab-head">
          <h2 className="mk-sectab-title">{title}</h2>
          {onReorder && (
            <Button size="sm" variant={editing ? 'primary' : 'secondary'} onClick={() => setEditing((v) => !v)}>
              {editing ? 'Done' : 'Reorder'}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={XIcon} label="Close" onClick={onClose} />
        </div>
        <p className="mk-sectab-hint">
          {editing ? 'Drag the grip or use the arrows.' : 'Tap a section to jump to it.'}
        </p>
        <ul className="mk-sectab-list">
          {items.map((it, i) => {
            const Icon = it.icon;
            if (!editing) {
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    className="mk-sectab-item"
                    onClick={() => onJump(it.id)}
                    aria-current={it.id === current ? 'true' : undefined}
                  >
                    {Icon && <Icon className="mk-sectab-item-icon" aria-hidden />}
                    <span className="mk-sectab-item-label">{it.label}</span>
                    {it.dot && <span className={`mk-sectab-dot mk-sectab-dot-${it.dot}`} role="img" aria-label={DOT_LABEL[it.dot] || it.dot} />}
                    {it.meta && <span className="mk-sectab-meta">{it.meta}</span>}
                  </button>
                </li>
              );
            }
            return (
              <li key={it.id} className={`mk-sectab-row${dragId === it.id ? ' mk-sectab-row-drag' : ''}`}>
                {Icon && <Icon className="mk-sectab-item-icon" aria-hidden />}
                <span className="mk-sectab-item-label">{it.label}</span>
                <Button size="sm" variant="ghost" icon={ArrowUpIcon} label={`Move ${it.label} up`} data-move={`${it.id}:-1`}
                  onClick={() => move(it.id, -1)} disabled={i === 0} />
                <Button size="sm" variant="ghost" icon={ArrowDownIcon} label={`Move ${it.label} down`} data-move={`${it.id}:1`}
                  onClick={() => move(it.id, 1)} disabled={i === items.length - 1} />
                <span className="mk-sectab-grip" onPointerDown={(e) => startDrag(e, it.id)} aria-hidden title="Drag to move">
                  <GripIcon />
                </span>
              </li>
            );
          })}
        </ul>
        {onFoldAll && (
          <div className="mk-sectab-foot">
            <Button variant="secondary" block onClick={() => onFoldAll(true)}>Fold all</Button>
            <Button variant="secondary" block onClick={() => onFoldAll(false)}>Open all</Button>
          </div>
        )}
      </aside>
    </div>
  );
}
