import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, act, renderHook, waitFor } from '@testing-library/react';
import {
  listParam, rangeParam, inRange, rangeBounds, rangeSummary, shortMoney, useSavedFilters,
  RangeFilter, SortTh, useSort, ColumnOrder, useColumnOrder, orderColumns, DataTable,
} from '../src/index.js';

const resetAll = () => {
  window.history.replaceState(null, '', '/');
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* */ }
};
beforeEach(resetAll);
afterEach(() => { cleanup(); resetAll(); vi.useRealTimers(); });

const go = (search) => window.history.replaceState(null, '', `/${search}`);
const qs = () => new URLSearchParams(window.location.search);

describe('filter helpers', () => {
  it('listParam splits, trims and drops empties', () => {
    expect(listParam('Honda, Toyota,,')).toEqual(['Honda', 'Toyota']);
    expect(listParam(null)).toEqual([]);
    expect(listParam('')).toEqual([]);
  });

  it('rangeParam reads two params from URLSearchParams, a string or an object', () => {
    expect(rangeParam(new URLSearchParams('minPrice=5000&maxPrice=12000'), 'minPrice', 'maxPrice')).toEqual([5000, 12000]);
    expect(rangeParam('?maxPrice=9000', 'minPrice', 'maxPrice')).toEqual([null, 9000]);
    expect(rangeParam({ minPrice: '300', maxPrice: '' }, 'minPrice', 'maxPrice')).toEqual([300, null]);
    expect(rangeParam('minPrice=abc&maxPrice=-5', 'minPrice', 'maxPrice')).toEqual([null, null]);
  });

  it('rangeParam reads legacy bands as the span they covered', () => {
    expect(rangeParam('price=0-5000,5000-10000', 'minPrice', 'maxPrice', 'price')).toEqual([null, 10000]);
    expect(rangeParam('price=20000-30000,40000-999999', 'minPrice', 'maxPrice', 'price')).toEqual([20000, null]);
    expect(rangeParam('price=junk', 'minPrice', 'maxPrice', 'price')).toEqual([null, null]);
    expect(rangeParam('minPrice=1&price=0-5000', 'minPrice', 'maxPrice', 'price')).toEqual([1, null]);
  });

  it('inRange includes both ends, treats null as open, and leaves blanks out of a set range', () => {
    expect(inRange(5000, [5000, 12000])).toBe(true);
    expect(inRange(12000, [5000, 12000])).toBe(true);
    expect(inRange(12001, [5000, 12000])).toBe(false);
    expect(inRange(1, [null, null])).toBe(true);
    expect(inRange(null, [null, null])).toBe(true);
    expect(inRange(null, [1, null])).toBe(false);
    expect(inRange('700', [null, 800])).toBe(true);
  });

  it('rangeBounds runs 0 to the max rounded up to a step, never zero-width', () => {
    expect(rangeBounds([1200, 45001, 300], 500)).toEqual([0, 45500]);
    expect(rangeBounds([], 500)).toEqual([0, 500]);
    expect(rangeBounds([100, null, 'x'], 250, [null, 9000])).toEqual([0, 9000]);
  });

  it('rangeSummary and shortMoney', () => {
    expect(rangeSummary([null, null], { allLabel: 'Any price' })).toBe('Any price');
    expect(rangeSummary([null, 10000])).toBe('Up to $10k');
    expect(rangeSummary([5000, 12000])).toBe('$5k–$12k');
    expect(rangeSummary([5500, null])).toBe('$5.5k+');
    expect(shortMoney(750)).toBe('$750');
  });
});

describe('useSavedFilters', () => {
  const KEYS = ['status', 'maxPrice'];

  it('a link is shown as is and saves nothing', () => {
    localStorage.setItem('t.f', JSON.stringify({ status: 'live' }));
    go('?status=planned');
    const { result } = renderHook(() => useSavedFilters('t.f', KEYS));
    expect(result.current.filters.status).toBe('planned');
    expect(JSON.parse(localStorage.getItem('t.f'))).toEqual({ status: 'live' });
  });

  it('a linkKey alone also counts as a link', () => {
    localStorage.setItem('t.f', JSON.stringify({ status: 'live' }));
    go('?q=ford');
    const { result } = renderHook(() => useSavedFilters('t.f', KEYS, { linkKeys: ['q'] }));
    expect(result.current.filters.status).toBe('');
    expect(qs().get('status')).toBeNull();
  });

  it('this session\'s parked filters win over the saved set', () => {
    localStorage.setItem('t.f', JSON.stringify({ status: 'live' }));
    sessionStorage.setItem('mk.parked.t.f', JSON.stringify({ status: 'progress', bogus: 'x' }));
    const { result } = renderHook(() => useSavedFilters('t.f', KEYS));
    expect(result.current.filters.status).toBe('progress');
    expect(qs().get('bogus')).toBeNull();
  });

  it('otherwise the saved set is applied, and unmounting parks the filters', () => {
    localStorage.setItem('t.f', JSON.stringify({ status: 'live', maxPrice: '9000' }));
    const { result, unmount } = renderHook(() => useSavedFilters('t.f', KEYS));
    expect(result.current.filters).toEqual({ status: 'live', maxPrice: '9000' });
    expect(qs().toString()).toBe('status=live&maxPrice=9000');
    unmount();
    expect(JSON.parse(sessionStorage.getItem('mk.parked.t.f'))).toEqual({ status: 'live', maxPrice: '9000' });
  });

  it('setFilters saves the whole set; resetFilters clears URL and saved copy', () => {
    go('?q=abc');
    const { result } = renderHook(() => useSavedFilters('t.f', KEYS));
    act(() => result.current.setFilters({ status: 'live' }));
    act(() => result.current.setFilters({ maxPrice: 5000 }));
    expect(result.current.filters).toEqual({ status: 'live', maxPrice: '5000' });
    expect(JSON.parse(localStorage.getItem('t.f'))).toEqual({ status: 'live', maxPrice: '5000' });
    act(() => result.current.resetFilters({ q: null }));
    expect(window.location.search).toBe('');
    expect(localStorage.getItem('t.f')).toBeNull();
    expect(sessionStorage.getItem('mk.parked.t.f')).toBeNull();
  });

  it('uses async load/save: cache first, then the account set replaces it', async () => {
    localStorage.setItem('t.f', JSON.stringify({ status: 'live' }));
    let resolve;
    const load = vi.fn(() => new Promise((r) => { resolve = r; }));
    const save = vi.fn(async () => {});
    const { result } = renderHook(() => useSavedFilters('t.f', KEYS, { load, save }));
    expect(result.current.filters.status).toBe('live');
    await waitFor(() => expect(load).toHaveBeenCalledWith('t.f'));
    await act(async () => { resolve({ maxPrice: '7000' }); });
    await waitFor(() => expect(result.current.filters).toEqual({ status: '', maxPrice: '7000' }));
    expect(JSON.parse(localStorage.getItem('t.f'))).toEqual({ maxPrice: '7000' });
    act(() => result.current.setFilters({ status: 'planned' }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('t.f', { status: 'planned', maxPrice: '7000' }));
  });

  it('a slow load never undoes a change made meanwhile, and a link skips load', async () => {
    let resolve;
    const load = vi.fn(() => new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useSavedFilters('t.f', KEYS, { load }));
    await waitFor(() => expect(load).toHaveBeenCalled());
    act(() => result.current.setFilters({ status: 'live' }));
    await act(async () => { resolve({ status: 'planned' }); });
    expect(result.current.filters.status).toBe('live');
    cleanup(); resetAll();
    go('?status=x');
    const load2 = vi.fn(async () => ({}));
    renderHook(() => useSavedFilters('t.f', KEYS, { load: load2 }));
    await act(async () => {});
    expect(load2).not.toHaveBeenCalled();
  });

  it('survives storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const spy2 = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useSavedFilters('t.f', KEYS));
    act(() => result.current.setFilters({ status: 'live' }));
    expect(result.current.filters.status).toBe('live');
    spy.mockRestore(); spy2.mockRestore();
  });
});

describe('RangeFilter', () => {
  function Harness({ initial = [null, null] }) {
    const [v, setV] = useState(initial);
    return (
      <>
        <RangeFilter label="Price" allLabel="Any price" value={v} bounds={[0, 20000]} step={500} onChange={(a, b) => setV([a, b])} />
        <output>{JSON.stringify(v)}</output>
        <button>outside</button>
      </>
    );
  }
  const out = () => JSON.parse(document.querySelector('output').textContent);

  it('summarises on the button and types exact figures', () => {
    render(<Harness />);
    const btn = screen.getByRole('button', { name: 'Any price' });
    fireEvent.click(btn);
    expect(screen.getByRole('group', { name: 'Price' })).toBeTruthy();
    const max = screen.getByLabelText('Max');
    fireEvent.change(max, { target: { value: '$10,000' } });
    fireEvent.keyDown(max, { key: 'Enter' });
    expect(out()).toEqual([null, 10000]);
    expect(btn.textContent).toBe('Up to $10k');
    expect(btn.getAttribute('aria-label')).toBe('Price: Up to $10k');
    expect(btn.className).toContain('mk-filter-btn-active');
    const min = screen.getByLabelText('Min');
    fireEvent.change(min, { target: { value: '5000' } });
    fireEvent.blur(min);
    expect(out()).toEqual([5000, 10000]);
    expect(btn.textContent).toBe('$5k–$10k');
  });

  it('a handle dragged to its end drops the limit; reports after the hand rests', () => {
    vi.useFakeTimers();
    render(<Harness initial={[null, 10000]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Price: Up to $10k' }));
    const hi = screen.getByLabelText('Price maximum');
    expect(hi.getAttribute('aria-valuetext')).toBe('$10,000');
    fireEvent.change(hi, { target: { value: '20000' } });
    expect(out()).toEqual([null, 10000]);
    act(() => { vi.advanceTimersByTime(350); });
    expect(out()).toEqual([null, null]);
    expect(screen.getByLabelText('Price maximum').getAttribute('aria-valuetext')).toBe('No limit');
  });

  it('closing reports a pending drag; Clear resets; Esc closes and refocuses', () => {
    render(<Harness />);
    const btn = screen.getByRole('button', { name: 'Any price' });
    fireEvent.click(btn);
    fireEvent.change(screen.getByLabelText('Price minimum'), { target: { value: '2500' } });
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('group')).toBeNull();
    expect(out()).toEqual([2500, null]);
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(out()).toEqual([null, null]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

describe('SortTh + useSort', () => {
  const ROWS = [{ n: 'b', v: 2 }, { n: 'a', v: null }, { n: 'c', v: 10 }];
  function T() {
    const sort = useSort(ROWS);
    return (
      <table><thead><tr><SortTh col="n" sort={sort}>Name</SortTh><SortTh col="v" sort={sort} align="right">Value</SortTh></tr></thead>
        <tbody>{sort.rows.map((r) => <tr key={r.n}><td>{r.n}</td></tr>)}</tbody></table>
    );
  }
  const names = () => [...document.querySelectorAll('tbody td')].map((td) => td.textContent).join('');

  it('toggles asc/desc with aria-sort; blanks last both ways', () => {
    render(<T />);
    const th = screen.getByRole('button', { name: 'Value' }).closest('th');
    expect(th.getAttribute('aria-sort')).toBeNull();
    expect(th.className).toContain('mk-dt-right');
    fireEvent.click(screen.getByRole('button', { name: 'Value' }));
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(names()).toBe('bca');
    fireEvent.click(screen.getByRole('button', { name: 'Value' }));
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(names()).toBe('cba');
    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(names()).toBe('abc');
    expect(th.getAttribute('aria-sort')).toBeNull();
  });
});

describe('ColumnOrder', () => {
  const COLS = [{ key: 'a', label: 'Alpha', locked: true }, { key: 'b', label: 'Beta' }, { key: 'c', label: 'Gamma', hidden: true }];

  it('orderColumns drops unknown keys and slots new columns after their default neighbour', () => {
    const cols = [{ key: 'a' }, { key: 'b' }, { key: 'n' }, { key: 'c' }];
    expect(orderColumns(cols, ['c', 'zz', 'b', 'a']).map((c) => c.key)).toEqual(['c', 'b', 'n', 'a']);
    expect(orderColumns(cols, null)).toBe(cols);
  });

  function Harness() {
    const cols = useColumnOrder('t.cols', COLS);
    return <><ColumnOrder {...cols.menu} /><output>{cols.columns.map((c) => c.key).join(',')}</output></>;
  }
  const out = () => document.querySelector('output').textContent;

  it('shows/hides, moves up and down, saves and resets', () => {
    render(<Harness />);
    expect(out()).toBe('a,b');
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByLabelText('Alpha').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Gamma'));
    expect(out()).toBe('a,b,c');
    fireEvent.click(screen.getByLabelText('Beta'));
    expect(out()).toBe('a,c');
    fireEvent.click(screen.getByRole('button', { name: 'Move Gamma up' }));
    expect(out()).toBe('a,c'); // moved past the hidden Beta
    fireEvent.click(screen.getByRole('button', { name: 'Move Gamma up' }));
    expect(out()).toBe('c,a');
    expect(screen.getByRole('button', { name: 'Move Gamma up' }).disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem('t.cols'))).toEqual({ order: ['c', 'a', 'b'], hidden: ['b'], shown: ['c'] });
    cleanup();
    render(<Harness />);
    expect(out()).toBe('c,a');
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset columns' }));
    expect(out()).toBe('a,b');
    expect(localStorage.getItem('t.cols')).toBeNull();
  });

  it('feeds DataTable, whose drag-reorder goes back through onReorder', () => {
    function T() {
      const cols = useColumnOrder('t.cols2', [{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }]);
      return <DataTable label="T" columns={cols.columns} onReorder={cols.onReorder} data={[{ id: 1, x: 'one', y: 'two' }]} mobileCards={false} />;
    }
    render(<T />);
    const heads = () => [...document.querySelectorAll('th')].map((th) => th.textContent).join('');
    expect(heads()).toBe('XY');
    const [thX, thY] = document.querySelectorAll('th');
    const dt = { setData() {}, effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(thX, { dataTransfer: dt });
    fireEvent.dragOver(thY, { dataTransfer: dt });
    fireEvent.drop(thY, { dataTransfer: dt });
    expect(heads()).toBe('YX');
    expect(JSON.parse(localStorage.getItem('t.cols2')).order).toEqual(['y', 'x']);
  });
});
