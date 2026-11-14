import { useMemo, useState } from 'react';
import { cx } from './cx.js';
import { ArrowUpIcon, ArrowDownIcon, ChevronsUpDownIcon } from './icons.jsx';

/**
 * A sortable header cell for a table you build yourself (DataTable uses it
 * too). The control is a <button> so it is reachable by keyboard, and the
 * <th> carries aria-sort. Click toggles ascending / descending.
 *
 *   const sort = useSort(rows, { defaultSort: { key: 'total', dir: 'desc' } });
 *   <table className="mk-dt-table"><thead><tr>
 *     <SortTh col="name" sort={sort}>Name</SortTh>
 *     <SortTh col="total" sort={sort} align="right">Total</SortTh>
 *   </tr></thead><tbody>{sort.rows.map(...)}</tbody></table>
 *
 * `sort` is { sortBy, sortDir, onSort(key, nextDir) }: useSort's result, or
 * your own for server-side sorting. Other props go on the <th>.
 */
export function SortTh({ col, sort, align, prefix, className, children, ...rest }) {
  const active = sort.sortBy === col;
  const dir = sort.sortDir === 'desc' ? 'desc' : 'asc';
  const Icon = active ? (dir === 'asc' ? ArrowUpIcon : ArrowDownIcon) : ChevronsUpDownIcon;
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cx(align === 'right' && 'mk-dt-right', align === 'center' && 'mk-dt-center', className)}
      {...rest}
    >
      <span className="mk-dt-th">
        {prefix}
        <button
          type="button"
          className={cx('mk-dt-sort', active && 'mk-dt-sort-active')}
          onClick={() => sort.onSort(col, active && dir === 'asc' ? 'desc' : 'asc')}
        >
          {children}
          <Icon className="mk-dt-sort-icon" />
        </button>
      </span>
    </th>
  );
}

const isBlank = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function compare(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/**
 * Rows sorted by `get(row)`, stable; blanks always last whatever the direction.
 * Numbers as numbers, text case-insensitive with digit runs as numbers ("Stock 9" < "Stock 10").
 */
export function sortRows(rows, get, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => [r, get(r), i]).sort((a, b) => {
    const ea = isBlank(a[1]), eb = isBlank(b[1]);
    if (ea || eb) return ea === eb ? a[2] - b[2] : ea ? 1 : -1;
    return compare(a[1], b[1]) * sign || a[2] - b[2];
  }).map((x) => x[0]);
}

/**
 * Click-to-sort state for SortTh. `values` maps a column key to how to read
 * it from a row (default row[key]).
 *   const sort = useSort(rows, { values: { date: (r) => Date.parse(r.date) } });
 *   sort.rows // sorted
 */
export function useSort(rows, { values = {}, defaultSort } = {}) {
  const [state, setState] = useState(() => ({ key: defaultSort?.key ?? null, dir: defaultSort?.dir ?? 'asc' }));
  const list = rows || [];
  const get = state.key ? (values[state.key] || ((r) => r[state.key])) : null;
  const sorted = useMemo(() => (get ? sortRows(list, get, state.dir) : list), [list, state, get]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    rows: sorted,
    sortBy: state.key,
    sortDir: state.dir,
    onSort: (key, dir) => setState({ key, dir }),
  };
}
