import { isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cx } from './cx.js';
import { ChevronDownIcon } from './icons.jsx';

const BTN = { primary: 'mk-btn-primary', secondary: 'mk-btn-secondary', ghost: 'mk-btn-ghost' };

/** Items left after hidden ones drop out, with no divider at either end or two in a row. */
export function visibleMenuItems(items) {
  const out = [];
  for (const it of items || []) {
    if (!it || (it !== 'sep' && it.hidden)) continue;
    if (it === 'sep' && (!out.length || out[out.length - 1] === 'sep')) continue;
    out.push(it);
  }
  while (out[out.length - 1] === 'sep') out.pop();
  return out;
}

/**
 * A button that opens a short list of actions (row "⋯", a toolbar's "More").
 * items: [{ label, onClick, danger?, disabled?, hidden?, icon? }] and 'sep' for a divider.
 * Closes on a pick, Esc (handled here, so a Modal around it stays open), Tab
 * or a click outside. Opening focuses the first item; ↑ ↓ Home End move.
 * An icon-only `label` needs `ariaLabel` and usually `caret={false}`.
 */
export function MenuButton({
  label, ariaLabel, items, caret = true, align = 'end',
  variant = 'secondary', size = 'sm', className, menuClassName, disabled = false,
}) {
  const [open, setOpen] = useState(false);
  // The side the menu actually opens to: `align`, unless that would push it off screen.
  const [side, setSide] = useState(align);
  const root = useRef(null);
  const btn = useRef(null);
  const menuId = useId();
  const btnId = useId();
  const shown = visibleMenuItems(items);

  useLayoutEffect(() => {
    if (!open) { setSide(align); return; }
    const menu = root.current?.querySelector('.mk-menu');
    if (!menu) return;
    const r = menu.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    if (r.left < 8 && align === 'end') setSide('start');
    else if (r.right > vw - 8 && align !== 'end') setSide('end');
  }, [open, align]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      setOpen(false); btn.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    root.current?.querySelector('.mk-menu-item:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const onMenuKey = (e) => {
    if (e.key === 'Tab') { setOpen(false); return; }
    const all = [...root.current.querySelectorAll('.mk-menu-item:not(:disabled)')];
    if (!all.length) return;
    const i = all.indexOf(document.activeElement);
    let next;
    if (e.key === 'ArrowDown') next = (i + 1) % all.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + all.length) % all.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = all.length - 1;
    else return;
    e.preventDefault();
    all[next].focus();
  };

  const btnClass = className || cx('mk-btn', BTN[variant] || BTN.secondary, size !== 'md' && `mk-btn-${size}`, !caret && 'mk-btn-icon');

  return (
    <div ref={root} className="mk-menu-wrap">
      <button
        ref={btn}
        id={btnId}
        type="button"
        className={btnClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {caret && <ChevronDownIcon className="mk-menu-caret" aria-hidden />}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-labelledby={btnId} tabIndex={-1} className={cx('mk-menu', side === 'end' && 'mk-menu-end', menuClassName)} onKeyDown={onMenuKey}>
          {shown.map((it, i) => (it === 'sep' ? (
            <div key={`sep-${i}`} className="mk-menu-sep" role="separator" />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={cx('mk-menu-item', it.danger && 'mk-menu-item-danger')}
              disabled={it.disabled}
              onClick={() => { setOpen(false); btn.current?.focus(); it.onClick?.(); }}
            >
              {it.icon && (isValidElement(it.icon) ? it.icon : <it.icon className="mk-icon" aria-hidden />)}
              <span>{it.label}</span>
            </button>
          )))}
        </div>
      )}
    </div>
  );
}
