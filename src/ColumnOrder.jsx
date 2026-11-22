import { Children, cloneElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from './cx.js';
import { ArrowUpIcon, ArrowDownIcon, ChevronDownIcon, GripIcon } from './icons.jsx';
import { writePref } from './prefs.js';

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
const isPrefs = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  && ['order', 'hidden', 'shown'].some((k) => Array.isArray(v[k]));
/** Off until someone ticks it: `hidden: true`, or `on: false`. */
const offByDefault = (c) => !!c.hidden || c.on === false;

function readRaw(key) {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; }
}

/**
 * A stored value as { order, hidden, shown }. A bare array of keys (an older
 * order-only save) is read as the order; any other shape goes through
 * `migrate(value, columns)` when given, else is ignored.
 */
function toPrefs(value, columns, migrate) {
  if (value == null) return EMPTY;
  if (isPrefs(value)) return cleanPrefs(value);
  if (Array.isArray(value)) return { ...EMPTY, order: strings(value) };
  if (migrate) {
    try { return cleanPrefs(migrate(value, columns)); } catch { return EMPTY; }
  }
  return EMPTY;
}

/**
 * Drag one header onto another to move its column. `onMove(key, targetKey, after)`;
 * returns `(key) => props` to spread on each movable header cell (a <th>).
 * A click still sorts: once a drag starts the browser sends no click.
 */
export function useHeaderDrag(onMove) {
  const [drag, setDrag] = useState(null);
  const [drop, setDrop] = useState(null); // { key, after }
  if (!onMove) return () => ({});
  const end = () => { setDrag(null); setDrop(null); };
  return (key) => ({
    draggable: true,
    className: cx(
      'mk-col-draggable',
      drag === key && 'mk-col-dragging',
      drag && drag !== key && drop?.key === key && (drop.after ? 'mk-col-drop-after' : 'mk-col-drop-before'),
    ) || undefined,
    onDragStart: (e) => {
      setDrag(key);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key); // Firefox starts no drag without data
      }
    },
    onDragOver: (e) => {
      if (!drag || drag === key) return;
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      const after = e.clientX > box.left + box.width / 2;
      if (drop?.key !== key || drop.after !== after) setDrop({ key, after });
    },
    onDrop: (e) => {
      e.preventDefault();
      if (drag && drop && drag !== drop.key) onMove(drag, drop.key, drop.after);
      end();
    },
    onDragEnd: end,
  });
}

/**
 * Puts hand-written table cells into a saved column order, for tables that
 * aren't a DataTable. Give each movable cell `data-col="<key>"`; untagged cells
 * stay where they were written, and tagged ones only trade places with each
 * other. On the header row pass `onMove` (useColumnOrder's `moveNextTo`) and
 * the headers can be dragged onto one another.
 *
 *   <tr><OrderedCells order={cols.order} onMove={cols.moveNextTo}>
 *     {cols.isShown('date') && <th data-col="date">Date</th>}
 *     <th data-col="name">Name</th>
 *   </OrderedCells></tr>
 */
export function OrderedCells({ order = [], onMove, noMove = [], children }) {
  const dragProps = useHeaderDrag(onMove);
  const items = Children.toArray(children);
  const keyOf = (el) => el?.props?.['data-col'];
  const rank = (el) => { const i = order.indexOf(keyOf(el)); return i < 0 ? Infinity : i; };
  let tagged = items.filter((el) => keyOf(el) != null).sort((a, b) => rank(a) - rank(b));
  if (onMove) {
    tagged = tagged.map((el) => {
      const key = keyOf(el);
      if (noMove.includes(key)) return el;
      const p = dragProps(key);
      return cloneElement(el, {
        ...p,
        className: cx(el.props.className, p.className) || undefined,
        title: el.props.title ?? 'Drag to move this column',
      });
    });
  }
  let next = 0;
  return items.map((el) => (keyOf(el) != null ? tagged[next++] : el));
}

/**
 * Which columns a table shows, and in what order, saved under `prefKey`
 * (localStorage; pass async load/save to keep it on the account, as with
 * useSavedFilters). Columns: { key, label, hidden? or on: false (default off),
 * locked? (never hidden), noMove? (no move controls of its own), disabled? (box greyed out) }.
 *
 * Options: load/save (account), storageKey (the browser copy's key, default
 * prefKey), migrate(value, columns) -> { order, hidden, shown } for a value
 * saved in an older shape (a bare array of keys is read as the order).
 *
 *   const cols = useColumnOrder('trips.columns', COLUMNS, { load, save });
 *   <ColumnOrder {...cols.menu} />
 *   <DataTable columns={cols.columns} onReorder={cols.onReorder} ... />
 *
 * Saved as overrides { order, hidden, shown }, so a column added later still shows in its
 * default place.
 */
export function useColumnOrder(prefKey, columns, { load, save, storageKey = prefKey, migrate } = {}) {
  const io = useRef({ load, save, migrate, columns });
  io.current = { load, save, migrate, columns };
  const readLocal = () => toPrefs(readRaw(storageKey), io.current.columns, io.current.migrate);
  const [prefs, setPrefs] = useState(readLocal);
  const touched = useRef(false);

  useEffect(() => {
    touched.current = false;
    setPrefs(readLocal());
    const { load: loadFn } = io.current;
    if (!loadFn) return undefined;
    let live = true;
    Promise.resolve().then(() => loadFn(prefKey)).then((saved) => {
      if (!live || touched.current || saved == null) return;
      const next = toPrefs(saved, io.current.columns, io.current.migrate);
      setPrefs(next);
      writePref(storageKey, next);
    }).catch(() => { /* the local copy stands */ });
    return () => { live = false; };
  }, [prefKey, storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next) => {
    touched.current = true;
    setPrefs(next);
    const empty = !next.order.length && !next.hidden.length && !next.shown.length;
    writePref(storageKey, empty ? null : next);
    const { save: saveFn } = io.current;
    if (saveFn) Promise.resolve().then(() => saveFn(prefKey, empty ? null : next)).catch(() => {});
  };

  const ordered = useMemo(() => orderColumns(columns, prefs.order), [columns, prefs.order]);
  const colOf = (c) => (typeof c === 'string' ? columns.find((x) => x.key === c) : c);
  const isShown = (c) => {
    const col = colOf(c);
    if (!col) return false;
    return !!col.locked || (offByDefault(col) ? prefs.shown.includes(col.key) : !prefs.hidden.includes(col.key));
  };
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
    if (offByDefault(col) && on) shown.push(key); // a default-off column switched on
    if (!offByDefault(col) && !on) hidden.push(key);
    commit({ ...prefs, hidden, shown });
  };

  const moveNextTo = (key, target, after = false) => {
    const rest = keys.filter((k) => k !== key);
    const at = rest.indexOf(target);
    if (at < 0 || key === target) return;
    moveTo(key, at + (after ? 1 : 0));
  };

  return {
    columns: visible,
    allColumns: ordered,
    /** Every key in the saved order (shown or not), for <OrderedCells order>. */
    order: keys,
    isShown,
    move: (key, delta) => moveTo(key, keys.indexOf(key) + delta),
    moveTo,
    /** Put `key` just before (or `after`) `target`: header drag, <OrderedCells onMove>. */
    moveNextTo,
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
      columns: ordered.map((c) => ({ key: c.key, label: c.label, locked: !!c.locked, noMove: !!c.noMove, disabled: !!c.disabled, shown: isShown(c) })),
      onToggle: toggle,
      onMove: (key, delta) => moveTo(key, keys.indexOf(key) + delta),
      onMoveTo: moveTo,
      onReset: () => commit(EMPTY),
    },
  };
}

/**
 * A "Columns" button with a checklist of a table's columns, each with Move
 * up / Move down buttons. Stays open while ticking. Usually fed by
 * useColumnOrder's `menu`.
 */
export function ColumnOrder({ columns, onToggle, onMove, onMoveTo, onReset, label = 'Columns', align = 'end', className = '', buttonClassName }) {
  const [open, setOpen] = useState(false);
  // Row drag (when onMoveTo is given): the row held, and the gap it would land in
  // (0 = above the first row, columns.length = below the last).
  const [dragKey, setDragKey] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const root = useRef(null);
  const btn = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    // Capture phase, and marked handled: a Modal around the menu listens on document
    // too and would otherwise close along with the menu.
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const shownCount = columns.filter((c) => c.shown).length;
  const endDrag = () => { setDragKey(null); setDropAt(null); };
  const dropRow = () => {
    const from = columns.findIndex((c) => c.key === dragKey);
    if (from >= 0 && dropAt != null && dropAt !== from && dropAt !== from + 1) {
      onMoveTo(dragKey, dropAt > from ? dropAt - 1 : dropAt);
    }
    endDrag();
  };
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
      <button ref={btn} type="button" className={buttonClassName || 'mk-filter-btn'} aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        <span className="mk-filter-text">{label}</span>
        <ChevronDownIcon className="mk-filter-chevron" />
      </button>
      {open && (
        <div id={menuId} role="group" aria-label={`${label} to show`} className={cx('mk-filter-menu', 'mk-cols-menu', align === 'end' && 'mk-filter-menu-end')}>
          {columns.map((c, i) => {
            const movable = !c.noMove;
            const canDrag = !!onMoveTo && movable;
            return (
              <div
                key={c.key}
                data-col={c.key}
                className={cx(
                  'mk-cols-row',
                  canDrag && 'mk-cols-draggable',
                  dragKey === c.key && 'mk-cols-dragging',
                  dragKey && dropAt === i && 'mk-cols-drop-before',
                  dragKey && dropAt === columns.length && i === columns.length - 1 && 'mk-cols-drop-after',
                )}
                draggable={canDrag || undefined}
                onDragStart={canDrag ? (e) => {
                  setDragKey(c.key);
                  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.key); }
                } : undefined}
                onDragOver={onMoveTo ? (e) => {
                  if (!dragKey) return;
                  e.preventDefault();
                  const box = e.currentTarget.getBoundingClientRect();
                  setDropAt(e.clientY > box.top + box.height / 2 ? i + 1 : i);
                } : undefined}
                onDrop={onMoveTo ? (e) => { e.preventDefault(); dropRow(); } : undefined}
                onDragEnd={onMoveTo ? endDrag : undefined}
              >
                {onMoveTo && <span className="mk-cols-grip" aria-hidden="true">{canDrag && <GripIcon />}</span>}
                <label className="mk-filter-option" title={c.locked ? 'Always shown' : undefined}>
                  <input
                    type="checkbox"
                    checked={c.shown}
                    disabled={c.locked || c.disabled || (c.shown && shownCount <= 1)}
                    onChange={(e) => onToggle(c.key, e.target.checked)}
                  />
                  <span className="mk-filter-option-label">{c.label}</span>
                </label>
                {movable && onMove && (
                  <>
                    <button type="button" className="mk-icon-btn mk-cols-move" data-move="up" aria-label={`Move ${c.label} up`} disabled={i === 0} onClick={() => move(c.key, -1)}>
                      <ArrowUpIcon />
                    </button>
                    <button type="button" className="mk-icon-btn mk-cols-move" data-move="down" aria-label={`Move ${c.label} down`} disabled={i === columns.length - 1} onClick={() => move(c.key, 1)}>
                      <ArrowDownIcon />
                    </button>
                  </>
                )}
              </div>
            );
          })}
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
