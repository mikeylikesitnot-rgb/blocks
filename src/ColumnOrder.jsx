import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from './cx.js';
import { ArrowUpIcon, ArrowDownIcon, ChevronDownIcon } from './icons.jsx';
import { readPref, writePref } from './prefs.js';

/** `columns` in the saved order: unknown keys dropped, new columns slotted in after the one they follow by default. */
export function orderColumns(columns, saved) {
  if (!Array.isArray(saved) || !saved.length) return columns;
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const keys = [...new Set(saved.filter((k) => byKey.has(k)))];
  columns.forEach((c, i) => {
    if (keys.includes(c.key)) return;
    const prev = columns.slice(0, i).reverse().find((p) => keys.includes(p.key));
    keys.splice(prev ? keys.indexOf(prev.key) + 1 : 0, 0, c.key);
  });
  return keys.map((k) => byKey.get(k));
}

const strings = (a) => (Array.isArray(a) ? a.filter((k) => typeof k === 'string') : []);
const cleanPrefs = (v) => ({ order: strings(v?.order), hidden: strings(v?.hidden), shown: strings(v?.shown) });
const EMPTY = { order: [], hidden: [], shown: [] };

/**
 * Which columns a table shows, and in what order, saved under `prefKey`
 * (localStorage; pass async load/save to keep it on the account, as with
 * useSavedFilters). Columns: { key, label, hidden? (default off), locked? (never hidden) }.
 *
 *   const cols = useColumnOrder('trips.columns', COLUMNS, { load, save });
 *   <ColumnOrder {...cols.menu} />
 *   <DataTable columns={cols.columns} onReorder={cols.onReorder} ... />
 *
 * Saved as overrides { order, hidden, shown }, so a column added later still shows in its
 * default place.
 */
export function useColumnOrder(prefKey, columns, { load, save } = {}) {
  const [prefs, setPrefs] = useState(() => cleanPrefs(readPref(prefKey)));
  const touched = useRef(false);
  const io = useRef({ load, save });
  io.current = { load, save };

  useEffect(() => {
    touched.current = false;
    setPrefs(cleanPrefs(readPref(prefKey)));
    const { load: loadFn } = io.current;
    if (!loadFn) return undefined;
    let live = true;
    Promise.resolve().then(() => loadFn(prefKey)).then((saved) => {
      if (!live || touched.current || !saved || typeof saved !== 'object') return;
      const next = cleanPrefs(saved);
      setPrefs(next);
      writePref(prefKey, next);
    }).catch(() => { /* the local copy stands */ });
    return () => { live = false; };
  }, [prefKey]);

  const commit = (next) => {
    touched.current = true;
    setPrefs(next);
    const empty = !next.order.length && !next.hidden.length && !next.shown.length;
    writePref(prefKey, empty ? null : next);
    const { save: saveFn } = io.current;
    if (saveFn) Promise.resolve().then(() => saveFn(prefKey, empty ? null : next)).catch(() => {});
  };

  const ordered = useMemo(() => orderColumns(columns, prefs.order), [columns, prefs.order]);
  const isShown = (c) => !!c.locked || (c.hidden ? prefs.shown.includes(c.key) : !prefs.hidden.includes(c.key));
  const visible = ordered.filter(isShown);

  const keys = ordered.map((c) => c.key);
  const moveTo = (key, to) => {
    const next = keys.filter((k) => k !== key);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, key);
    commit({ ...prefs, order: next });
  };
  const toggle = (key, on) => {
    const col = columns.find((c) => c.key === key);
    if (!col || col.locked) return;
    if (!on && visible.length <= 1) return; // keep at least one column
    const hidden = prefs.hidden.filter((k) => k !== key);
    const shown = prefs.shown.filter((k) => k !== key);
    if (col.hidden && on) shown.push(key); // a default-off column switched on
    if (!col.hidden && !on) hidden.push(key);
    commit({ ...prefs, hidden, shown });
  };

  return {
    columns: visible,
    allColumns: ordered,
    isShown,
    move: (key, delta) => moveTo(key, keys.indexOf(key) + delta),
    toggle,
    reset: () => commit(EMPTY),
    /** For <DataTable onReorder>: indexes are among the visible columns. */
    onReorder: (from, to) => {
      const k = visible[from]?.key;
      const target = visible[to]?.key;
      if (!k || !target) return;
      moveTo(k, keys.indexOf(target));
    },
    menu: {
      columns: ordered.map((c) => ({ key: c.key, label: c.label, locked: !!c.locked, shown: isShown(c) })),
      onToggle: toggle,
      onMove: (key, delta) => moveTo(key, keys.indexOf(key) + delta),
      onReset: () => commit(EMPTY),
    },
  };
}

/**
 * A "Columns" button with a checklist of a table's columns, each with Move
 * up / Move down buttons. Stays open while ticking. Usually fed by
 * useColumnOrder's `menu`.
 */
export function ColumnOrder({ columns, onToggle, onMove, onReset, label = 'Columns', align = 'end', className = '' }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const btn = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shownCount = columns.filter((c) => c.shown).length;
  const move = (key, delta) => {
    onMove(key, delta);
    // The row moves; keep focus on the same button if it still exists.
    const which = delta < 0 ? 'up' : 'down';
    requestAnimationFrame(() => {
      const el = root.current?.querySelector(`[data-col="${key}"] [data-move="${which}"]:not(:disabled)`)
        || root.current?.querySelector(`[data-col="${key}"] input`);
      el?.focus();
    });
  };

  return (
    <div ref={root} className={cx('mk-filter', 'mk-cols', className)}>
      <button ref={btn} type="button" className="mk-filter-btn" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        <span className="mk-filter-text">{label}</span>
        <ChevronDownIcon className="mk-filter-chevron" />
      </button>
      {open && (
        <div id={menuId} role="group" aria-label={`${label} to show`} className={cx('mk-filter-menu', 'mk-cols-menu', align === 'end' && 'mk-filter-menu-end')}>
          {columns.map((c, i) => (
            <div key={c.key} data-col={c.key} className="mk-cols-row">
              <label className="mk-filter-option">
                <input
                  type="checkbox"
                  checked={c.shown}
                  disabled={c.locked || (c.shown && shownCount <= 1)}
                  onChange={(e) => onToggle(c.key, e.target.checked)}
                />
                <span className="mk-filter-option-label">{c.label}</span>
              </label>
              <button type="button" className="mk-icon-btn mk-cols-move" data-move="up" aria-label={`Move ${c.label} up`} disabled={i === 0} onClick={() => move(c.key, -1)}>
                <ArrowUpIcon />
              </button>
              <button type="button" className="mk-icon-btn mk-cols-move" data-move="down" aria-label={`Move ${c.label} down`} disabled={i === columns.length - 1} onClick={() => move(c.key, 1)}>
                <ArrowDownIcon />
              </button>
            </div>
          ))}
          {onReset && (
            <div className="mk-filter-foot">
              <button type="button" className="mk-link-btn" onClick={onReset}>Reset columns</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
