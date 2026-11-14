import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import {
  Button, Badge, toneFor, Field, Input, SearchInput, Modal, OverlayProvider, useConfirm, useToast,
  matchesQuery, StatCard, PlusIcon, XIcon, DataTable,
} from '../src/index.js';

afterEach(cleanup);

describe('Button', () => {
  it('renders variant and size classes', () => {
    render(<Button variant="secondary" size="sm">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).toBe('mk-btn mk-btn-secondary mk-btn-sm');
  });
  it('falls back to primary for an unknown variant', () => {
    render(<Button variant="nope">X</Button>);
    expect(screen.getByRole('button').className).toContain('mk-btn-primary');
  });
  it('icon-only uses label as accessible name', () => {
    render(<Button icon={XIcon} label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' }).className).toContain('mk-btn-icon');
  });
  it('loading disables and marks busy', () => {
    render(<Button loading icon={PlusIcon}>Save</Button>);
    const b = screen.getByRole('button');
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
  });
  it('href renders a link', () => {
    render(<Button href="/x">Go</Button>);
    expect(screen.getByRole('link', { name: 'Go' }).getAttribute('href')).toBe('/x');
  });
});

describe('Badge', () => {
  it('guesses tone from status words, case-insensitive', () => {
    expect(toneFor('Overdue')).toBe('danger');
    expect(toneFor('completed')).toBe('success');
    expect(toneFor('Sold', { Sold: 'success' })).toBe('success');
    expect(toneFor('whatever')).toBe('neutral');
  });
  it('renders nothing for empty text', () => {
    const { container } = render(<Badge text="" />);
    expect(container.innerHTML).toBe('');
  });
  it('explicit tone wins', () => {
    render(<Badge tone="accent">Hi</Badge>);
    expect(screen.getByText('Hi').className).toContain('mk-tone-accent');
  });
});

describe('Field', () => {
  it('links label, input and error', () => {
    render(<Field label="Email" error="Bad email"><Input /></Field>);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')).textContent).toBe('Bad email');
  });
});

describe('SearchInput', () => {
  it('clears on Escape and on the clear button', () => {
    let v = 'abc';
    const onChange = (x) => { v = x; };
    const { rerender } = render(<SearchInput value={v} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(v).toBe('');
    v = 'abc';
    rerender(<SearchInput value={v} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(v).toBe('');
  });
});

describe('StatCard', () => {
  it('shows a note line and a title tooltip', () => {
    const { container } = render(<StatCard label="Net" value="1" note="Split by days rented" title="How it is counted" />);
    expect(screen.getByText('Split by days rented')).toBeTruthy();
    expect(container.querySelector('.mk-stat').getAttribute('title')).toBe('How it is counted');
  });
  it('colours delta by direction and invert', () => {
    render(<><StatCard label="Rev" value="1" delta={5} /><StatCard label="Cost" value="1" delta={5} invert /></>);
    const deltas = document.querySelectorAll('.mk-delta');
    expect(deltas[0].className).toContain('mk-delta-good');
    expect(deltas[1].className).toContain('mk-delta-bad');
  });
});

describe('Modal', () => {
  it('closes on Escape and renders nothing when closed', () => {
    let closed = false;
    const { rerender } = render(<Modal open title="Hi" onClose={() => { closed = true; }}>Body</Modal>);
    expect(screen.getByRole('dialog', { name: 'Hi' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closed).toBe(true);
    rerender(<Modal open={false} title="Hi" onClose={() => {}}>Body</Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('OverlayProvider', () => {
  function Harness({ onResult }) {
    const confirm = useConfirm();
    const toast = useToast();
    return (
      <>
        <button onClick={async () => onResult(await confirm({ title: 'Delete?', confirmLabel: 'Delete', danger: true }))}>ask</button>
        <button onClick={() => toast('Saved!')}>toast</button>
      </>
    );
  }
  it('confirm resolves true/false and toast shows', async () => {
    const results = [];
    render(<OverlayProvider><Harness onResult={(r) => results.push(r)} /></OverlayProvider>);
    fireEvent.click(screen.getByText('ask'));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Delete' })); });
    fireEvent.click(screen.getByText('ask'));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Cancel' })); });
    expect(results).toEqual([true, false]);
    fireEvent.click(screen.getByText('toast'));
    expect(await screen.findByText('Saved!')).toBeTruthy();
  });
});

describe('matchesQuery', () => {
  it('matches word prefixes and digits anywhere', () => {
    expect(matchesQuery('ana 2415', ['Ana Lopez', '(214) 555-2415'])).toBe(true);
    expect(matchesQuery('lop', ['Ana Lopez'])).toBe(true);
    expect(matchesQuery('ben', ['Ana Lopez'])).toBe(false);
    expect(matchesQuery('', [])).toBe(true);
  });
});

describe('DataTable', () => {
  const COLS = [
    { key: 'name', label: 'Name', mobile: 'title' },
    { key: 'city', label: 'City' },
    { key: 'total', label: 'Total' },
  ];
  const DATA = [
    { id: 1, name: 'Ben', city: 'Plano', total: 20 },
    { id: 2, name: 'Ana', city: 'Dallas', total: 300 },
    { id: 3, name: 'Chris', city: 'Frisco', total: 5 },
  ];
  const table = () => within(screen.getByRole('table'));
  const names = () => table().getAllByRole('row').slice(1).map((r) => r.cells[0].textContent);

  it('renders a row per item, plus a phone card per item', () => {
    render(<DataTable columns={COLS} data={DATA} />);
    expect(table().getAllByRole('row')).toHaveLength(4);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(table().getByText('Frisco')).toBeTruthy();
  });

  it('sorts ascending then descending on header click', () => {
    render(<DataTable columns={COLS} data={DATA} />);
    expect(names()).toEqual(['Ben', 'Ana', 'Chris']);
    fireEvent.click(table().getByRole('button', { name: 'Total' }));
    expect(names()).toEqual(['Chris', 'Ben', 'Ana']);
    expect(table().getAllByRole('columnheader')[2].getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(table().getByRole('button', { name: 'Total' }));
    expect(names()).toEqual(['Ana', 'Ben', 'Chris']);
    expect(table().getAllByRole('columnheader')[2].getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(table().getByRole('button', { name: 'Name' }));
    expect(names()).toEqual(['Ana', 'Ben', 'Chris']);
  });

  it('hands sorting to onSort when controlled', () => {
    const calls = [];
    render(<DataTable columns={COLS} data={DATA} sortBy="total" sortDir="asc" onSort={(...a) => calls.push(a)} />);
    expect(names()).toEqual(['Ben', 'Ana', 'Chris']);
    fireEvent.click(table().getByRole('button', { name: 'Total' }));
    expect(calls).toEqual([['total', 'desc']]);
  });

  it('right-aligns numeric columns only', () => {
    render(<DataTable columns={COLS} data={DATA} />);
    const [nameTh, , totalTh] = table().getAllByRole('columnheader');
    expect(totalTh.className).toContain('mk-dt-right');
    expect(nameTh.className).not.toContain('mk-dt-right');
    expect(table().getByText('300').className).toContain('mk-dt-right');
  });

  it('shows the empty state', () => {
    render(<DataTable columns={COLS} data={[]} empty={{ title: 'No trips yet', body: 'Import one.' }} />);
    expect(screen.getByText('No trips yet')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('shows the filtered state with a working Clear filters', () => {
    let cleared = 0;
    render(<DataTable columns={COLS} data={[]} filtered onClearFilters={() => { cleared += 1; }} />);
    expect(screen.getByText('Nothing matches these filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(cleared).toBe(1);
  });

  it('shows a skeleton while loading with no rows', () => {
    render(<DataTable columns={COLS} data={[]} loading />);
    expect(screen.getByLabelText('Loading').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Nothing here yet')).toBeNull();
  });

  it('remembers a reordered column order under storageKey', () => {
    localStorage.setItem('dt-test', JSON.stringify(['total', 'name']));
    render(<DataTable columns={COLS} data={DATA} reorderable storageKey="dt-test" />);
    expect(table().getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Total', 'Name', 'City']);
    localStorage.removeItem('dt-test');
  });
});
