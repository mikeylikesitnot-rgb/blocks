import { useMemo, useRef, useState, useSyncExternalStore, isValidElement } from 'react';
import { cx } from './cx.js';
import { EmptyState, SkeletonRows } from './States.jsx';
import { GripIcon } from './icons.jsx';
import { SortTh, sortRows } from './SortTh.jsx';

/**
 * Sortable table that turns into a card list on phones (< 768px).
 *
 *   <DataTable columns={[
 *       { key: 'name', label: 'Name', mobile: 'title' },
 *       { key: 'status', label: 'Status', render: (v) => <Badge text={v} />, mobile: 'badge' },
 *       { key: 'total', label: 'Total', render: money },          // numbers right-align by themselves
 *     ]}
 *     data={rows} rowKey={(r) => r.id} onRowClick={open}
 *     filtered={!!q} onClearFilters={clear} stickyHeader />
 *
 * Column: key, label, render(value, row), sortable (false to opt out),
 *   sortValue(row) (what to sort by when the cell shows something else),
 *   align 'left'|'right'|'center' (numbers auto-detect right),
 *   mobile 'title'|'subtitle'|'badge'|'hide' (role in the phone card), className, width.
 *
 * Sorting is built in. Pass sortBy/sortDir/onSort(key, nextDir) to control it
 * (e.g. server-side sorting); onSort alone without sortBy is still controlled.
 * Column order: pass onReorder(from, to) to own it, or `reorderable` (plus an
 * optional `storageKey`) to let the table keep and remember it itself.
 *
 * By default both layouts are rendered and CSS shows one. Pass `singleLayout`
 * when cells hold controls (inputs, selects, buttons): only the layout for the
 * current width is rendered (via matchMedia), so each control exists once, with
 * no duplicate ids, labels, tab stops or effects.
 */
export function DataTable({
  columns, data, onRowClick, rowKey, rowClassName,
  sortable = true, sortBy: sortByProp, sortDir: sortDirProp, onSort, defaultSort,
  onReorder, reorderable = false, storageKey,
  loading = false, empty, filtered = false, onClearFilters,
  dense = false, stickyHeader = false, maxHeight = '70vh', mobileCards = true, singleLayout = false,
  label, className = '',
}) {
  const rows = data || [];
  const phone = useMatchMedia(PHONE_QUERY);
  const showCards = mobileCards && (!singleLayout || phone);
  const showTable = !mobileCards || !singleLayout || !phone;
  const controlled = !!onSort;
  const [innerSort, setInnerSort] = useState(() => ({ key: defaultSort?.key ?? null, dir: defaultSort?.dir ?? 'asc' }));
  const sortBy = controlled ? sortByProp : innerSort.key;
  const sortDir = (controlled ? sortDirProp : innerSort.dir) === 'desc' ? 'desc' : 'asc';

  const [order, setOrder] = useState(() => readOrder(storageKey));
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const dragRef = useRef(null);
  const canReorder = !!onReorder || reorderable;

  const cols = useMemo(() => (onReorder || !order ? columns : applyOrder(columns, order)), [columns, order, onReorder]);

  const aligns = useMemo(() => {
    const out = {};
    for (const col of cols) {
      if (col.align) { out[col.key] = col.align; continue; }
      const sample = rows.slice(0, 25).map((r) => r[col.key]).filter((v) => v != null && v !== '');
      out[col.key] = sample.length && sample.every((v) => typeof v === 'number') && !/id$/i.test(col.key) ? 'right' : 'left';
    }
    return out;
  }, [cols, rows]);

  const sorted = useMemo(() => {
    if (controlled || !sortBy) return rows;
    const col = columns.find((c) => c.key === sortBy);
    if (!col) return rows;
    return sortRows(rows, col.sortValue || ((r) => r[col.key]), sortDir);
  }, [rows, columns, sortBy, sortDir, controlled]);

  const wrapCls = cx('mk-dt', dense && 'mk-dt-dense', className);

  if (loading && rows.length === 0) {
    return <div className={wrapCls}><SkeletonRows cols={Math.min(cols.length, 6)} /></div>;
  }

  if (rows.length === 0) {
    if (isValidElement(empty)) return <div className={wrapCls}>{empty}</div>;
    const e = typeof empty === 'string' ? { title: empty } : (empty || {});
    return (
      <div className={wrapCls}>
        <EmptyState compact variant={filtered ? 'filtered' : 'empty'} title={e.title} body={e.body} action={e.action} onClear={onClearFilters} />
      </div>
    );
  }

  const keyOf = (row, i) => (rowKey ? rowKey(row, i) : row.id ?? i);
  const alignCls = (k) => (aligns[k] === 'right' ? 'mk-dt-right' : aligns[k] === 'center' ? 'mk-dt-center' : null);
  const cellValue = (col, row) => {
    const v = col.render ? col.render(row[col.key], row) : row[col.key];
    return v == null || v === '' ? <span className="mk-dt-blank">—</span> : v;
  };

  const sortState = {
    sortBy,
    sortDir,
    onSort: (key, nextDir) => (controlled ? onSort(key, nextDir) : setInnerSort({ key, dir: nextDir })),
  };

  const moveColumn = (from, to) => {
    if (onReorder) { onReorder(from, to); return; }
    const keys = cols.map((c) => c.key);
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k);
    setOrder(keys);
    writeOrder(storageKey, keys);
  };
  const dragStart = (e, idx) => {
    setDragIdx(idx); dragRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };
  const dragOver = (e, idx) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (idx !== overIdx) setOverIdx(idx); };
  const drop = (e, to) => {
    e.preventDefault();
    const from = dragRef.current;
    if (from != null && from !== to) moveColumn(from, to);
    setDragIdx(null); setOverIdx(null); dragRef.current = null;
  };
  const dragEnd = () => { setDragIdx(null); setOverIdx(null); dragRef.current = null; };

  const rowProps = (row) => (onRowClick ? {
    onClick: () => onRowClick(row),
    onKeyDown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row); },
    tabIndex: 0,
  } : {});

  /* Phone layout: each row is a card. */
  let cards = null;
  if (showCards) {
    const titleCol = cols.find((c) => c.mobile === 'title') || cols.find((c) => !c.mobile) || cols[0];
    const subCols = cols.filter((c) => c !== titleCol && c.mobile === 'subtitle');
    const badgeCols = cols.filter((c) => c !== titleCol && c.mobile === 'badge');
    const bodyCols = cols.filter((c) => c !== titleCol && !c.mobile);
    cards = (
      <ul className="mk-dt-cards" aria-label={label}>
        {sorted.map((row, i) => (
          <li key={keyOf(row, i)} className={cx('mk-dt-card', onRowClick && 'mk-dt-clickable', rowClassName?.(row))} {...rowProps(row)}>
            <div className="mk-dt-card-head">
              <div className="mk-dt-card-title">{cellValue(titleCol, row)}</div>
              {badgeCols.length > 0 && <div className="mk-dt-card-badges">{badgeCols.map((c) => <span key={c.key}>{cellValue(c, row)}</span>)}</div>}
            </div>
            {subCols.length > 0 && <div className="mk-dt-card-sub">{subCols.map((c) => <span key={c.key}>{cellValue(c, row)}</span>)}</div>}
            {bodyCols.length > 0 && (
              <dl className="mk-dt-card-body">
                {bodyCols.map((c) => (
                  <div key={c.key}>
                    <dt>{typeof c.label === 'string' ? c.label : c.key}</dt>
                    <dd className="mk-tabular">{cellValue(c, row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={wrapCls} aria-busy={loading || undefined}>
      {cards}
      {showTable && <div
        className={cx('mk-dt-scroll', mobileCards && !singleLayout && 'mk-dt-has-cards', stickyHeader && 'mk-dt-sticky')}
        style={stickyHeader ? { maxHeight } : undefined}
      >
        <table className="mk-dt-table" aria-label={label}>
          <thead>
            <tr>
              {cols.map((col, idx) => {
                const canSort = sortable && col.sortable !== false;
                const thProps = {
                  key: col.key,
                  className: cx(dragIdx === idx && 'mk-dt-dragging', overIdx === idx && dragIdx !== idx && 'mk-dt-drop'),
                  style: col.width ? { width: col.width } : undefined,
                  draggable: canReorder || undefined,
                  onDragStart: canReorder ? (e) => dragStart(e, idx) : undefined,
                  onDragOver: canReorder ? (e) => dragOver(e, idx) : undefined,
                  onDrop: canReorder ? (e) => drop(e, idx) : undefined,
                  onDragEnd: canReorder ? dragEnd : undefined,
                };
                const grip = canReorder ? <GripIcon className="mk-dt-grip" /> : null;
                if (canSort) {
                  const { key, ...rest } = thProps;
                  return <SortTh key={key} {...rest} col={col.key} sort={sortState} align={aligns[col.key]} prefix={grip}>{col.label}</SortTh>;
                }
                const { key, ...rest } = thProps;
                return (
                  <th key={key} scope="col" {...rest} className={cx(alignCls(col.key), rest.className)}>
                    <span className="mk-dt-th">{grip}{col.label}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={keyOf(row, i)} className={cx(onRowClick && 'mk-dt-clickable', rowClassName?.(row))} {...rowProps(row)}>
                {cols.map((col) => (
                  <td key={col.key} className={cx(alignCls(col.key), col.className)}>{cellValue(col, row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

/* Matches kit.css: cards below 768px, table from 768px up. */
const PHONE_QUERY = '(max-width: 767.98px)';

/** Live result of a media query; false where matchMedia is missing (SSR, old test envs). */
function useMatchMedia(query) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.('change', onChange);
      return () => mql.removeEventListener?.('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Saved keys first (if still present), then any new columns in their given order. */
function applyOrder(columns, keys) {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const out = keys.filter((k) => byKey.has(k)).map((k) => byKey.get(k));
  return out.concat(columns.filter((c) => !keys.includes(c.key)));
}
function readOrder(storageKey) {
  if (!storageKey) return null;
  try {
    const v = JSON.parse(window.localStorage.getItem(storageKey));
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}
function writeOrder(storageKey, keys) {
  if (!storageKey) return;
  try { window.localStorage.setItem(storageKey, JSON.stringify(keys)); } catch { /* private mode / quota: order just won't persist */ }
}
