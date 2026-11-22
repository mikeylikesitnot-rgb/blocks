import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { useColumnOrder, ColumnOrder, OrderedCells, MenuButton, visibleMenuItems } from '../src/index.js';

beforeEach(() => { cleanup(); localStorage.clear(); });

const COLS = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C', on: false }, { key: 'd', label: 'D', noMove: true }];

function Table({ prefKey = 'k', opts }) {
  const cols = useColumnOrder(prefKey, COLS, opts);
  return (
    <>
      <ColumnOrder {...cols.menu} onMoveTo={cols.moveTo} />
      <table><thead><tr>
        <OrderedCells order={cols.order} onMove={cols.moveNextTo} noMove={['d']}>
          <th>sel</th>
          {cols.isShown('a') && <th data-col="a">A</th>}
          {cols.isShown('b') && <th data-col="b">B</th>}
          {cols.isShown('c') && <th data-col="c">C</th>}
          {cols.isShown('d') && <th data-col="d">D</th>}
        </OrderedCells>
      </tr></thead></table>
    </>
  );
}
const heads = () => [...document.querySelectorAll('th')].map((t) => t.textContent).join(',');

describe('useColumnOrder extras', () => {
  it('treats on:false as off by default', () => {
    render(<Table />);
    expect(heads()).toBe('sel,A,B,D');
  });

  it('reads a bare array as the order even when migrate is given', () => {
    localStorage.setItem('k', JSON.stringify(['b', 'a']));
    const migrate = vi.fn(() => { throw new Error('object only'); });
    render(<Table opts={{ migrate }} />);
    expect(migrate).not.toHaveBeenCalled();
    expect(heads()).toBe('sel,B,D,A');
  });

  it('reads an old bare-array order', () => {
    localStorage.setItem('k', JSON.stringify(['b', 'a']));
    render(<Table />);
    expect(heads()).toBe('sel,B,D,A'); // d slots in after c, its default neighbour
  });

  it('migrate converts another saved shape, and storageKey separates the browser copy', async () => {
    localStorage.setItem('local:k', JSON.stringify({ a: false, c: true, _order: ['c', 'b'] }));
    const migrate = vi.fn((v, columns) => {
      const order = v._order || [];
      const off = (k) => columns.find((c) => c.key === k)?.on === false;
      const keys = Object.keys(v).filter((k) => k !== '_order');
      return { order, hidden: keys.filter((k) => v[k] === false && !off(k)), shown: keys.filter((k) => v[k] === true && off(k)) };
    });
    render(<Table opts={{ storageKey: 'local:k', migrate }} />);
    expect(heads()).toBe('sel,C,D,B');
    // New-shape values are read as they are, not migrated.
    cleanup(); migrate.mockClear();
    localStorage.setItem('local:k', JSON.stringify({ order: ['b'], hidden: [], shown: [] }));
    render(<Table opts={{ storageKey: 'local:k', migrate }} />);
    expect(migrate).not.toHaveBeenCalled();
    expect(heads()).toBe('sel,A,B,D'); // a has no default neighbour before it, so it leads
  });

  it('migrates an account value too and keeps the browser copy in the new shape', async () => {
    const save = vi.fn(() => Promise.resolve());
    const load = vi.fn(() => Promise.resolve({ b: false }));
    const migrate = (v) => ({ hidden: Object.keys(v).filter((k) => v[k] === false) });
    render(<Table opts={{ load, save, migrate }} />);
    await waitFor(() => expect(heads()).toBe('sel,A,D'));
    expect(JSON.parse(localStorage.getItem('k'))).toEqual({ order: [], hidden: ['b'], shown: [] });
  });

  it('header drag moves a column next to another; noMove headers do not drag', () => {
    render(<Table />);
    const [, thA, thB] = document.querySelectorAll('th');
    const dt = { setData() {}, effectAllowed: '' };
    // jsdom drag events carry no clientX, so this lands "before" the target.
    fireEvent.dragStart(thB, { dataTransfer: dt });
    fireEvent.dragOver(thA, { dataTransfer: dt });
    fireEvent.drop(thA, { dataTransfer: dt });
    expect(heads()).toBe('sel,B,A,D');
    const thD = [...document.querySelectorAll('th')].find((t) => t.textContent === 'D');
    expect(thD.getAttribute('draggable')).toBeNull();
    expect(document.querySelector('th').getAttribute('draggable')).toBeNull(); // untagged cell
  });

  it('menu: noMove rows have no move buttons, disabled boxes stay off, rows drag', () => {
    function T() {
      const cols = useColumnOrder('k2', [{ key: 'x', label: 'X' }, { key: 'y', label: 'Y', disabled: true }, { key: 'z', label: 'Z', noMove: true }]);
      return <><ColumnOrder {...cols.menu} onMoveTo={cols.moveTo} /><output>{cols.columns.map((c) => c.key).join('')}</output></>;
    }
    render(<T />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByLabelText('Y').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Move Z up' })).toBeNull();
    const rows = document.querySelectorAll('.mk-cols-row');
    expect(rows[2].getAttribute('draggable')).toBeNull();
    const dt = { setData() {}, effectAllowed: '' };
    fireEvent.dragStart(rows[1], { dataTransfer: dt });
    fireEvent.dragOver(rows[0], { dataTransfer: dt });
    fireEvent.drop(rows[0], { dataTransfer: dt });
    expect(document.querySelector('output').textContent).toBe('yxz');
  });
});

describe('MenuButton', () => {
  it('visibleMenuItems drops hidden items and stray dividers', () => {
    const a = { label: 'a' }; const b = { label: 'b', hidden: true }; const c = { label: 'c' };
    expect(visibleMenuItems(['sep', a, 'sep', b, 'sep', c, 'sep'])).toEqual([a, 'sep', c]);
    expect(visibleMenuItems([a, 'sep', 'sep'])).toEqual([a]);
    expect(visibleMenuItems(null)).toEqual([]);
  });

  it('opens, focuses the first item, arrows move, Esc closes, a pick runs and closes', () => {
    const del = vi.fn();
    render(<MenuButton label="More" items={[{ label: 'Edit', onClick() {} }, { label: 'Off', disabled: true, onClick() {} }, 'sep', { label: 'Delete', danger: true, onClick: del }]} />);
    const btn = screen.getByRole('button', { name: /More/ });
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(btn);
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement.textContent).toBe('Delete'); // skips the disabled one
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(document.activeElement.textContent).toBe('Edit');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(del).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside click; icon-only trigger takes ariaLabel', () => {
    render(<><MenuButton label="⋯" ariaLabel="Row actions" caret={false} items={[{ label: 'X', onClick() {} }]} /><p>out</p></>);
    fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    act(() => { fireEvent.mouseDown(screen.getByText('out')); });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
