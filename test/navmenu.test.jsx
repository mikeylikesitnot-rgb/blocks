import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import { NavMenu, SidebarLayout, arrangeNav, searchNav, navGroups, orderKeys, SHELL_OPEN_EVENT } from '../src/index.js';

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* */ } });

const ITEMS = [
  { section: 'Daily', count: 6 },
  { value: 'today', label: 'Today', count: 4 },
  { value: 'tasks', label: 'Tasks', count: 2 },
  { section: 'Sales' },
  { value: 'leads', label: 'Leads', keywords: 'prospects' },
  { value: 'customers', label: 'Customers' },
  { section: 'Financing' },
  { value: 'financing', label: 'Contracts', keywords: ['deals', 'notes'] },
];

function Harness(props) {
  const [v, setV] = useState('today');
  return <NavMenu prefKey="t.menu" items={ITEMS} value={v} onChange={setV} label="Admin" {...props} />;
}
const labels = (c) => [...c.querySelectorAll('.mk-nav-item .mk-nav-label')].map((n) => n.textContent);
const sections = (c) => [...c.querySelectorAll('.mk-nav-section > span:first-child')].map((n) => n.textContent);

describe('NavMenu helpers', () => {
  it('groups items under their headings', () => {
    const g = navGroups([{ value: 'x', label: 'X' }, ...ITEMS]);
    expect(g.map((x) => [x.key, x.items.length])).toEqual([['', 1], ['Daily', 2], ['Sales', 2], ['Financing', 1]]);
  });
  it('keeps new keys in their default place and drops unknown ones', () => {
    expect(orderKeys(['a', 'b', 'c', 'd'], ['c', 'zz', 'a'])).toEqual(['c', 'd', 'a', 'b']);
    expect(orderKeys(['a', 'b'], null)).toEqual(['a', 'b']);
  });
  it('arranges favorites first, saved order, and hides pages unless editing', () => {
    const prefs = { fav: ['financing', 'gone'], order: { Sales: ['customers', 'leads'] }, hidden: ['tasks'] };
    const out = arrangeNav(ITEMS, prefs);
    expect(out.map((g) => [g.key, g.items.map((i) => i.value)])).toEqual([
      ['__fav', ['financing']], ['Daily', ['today']], ['Sales', ['customers', 'leads']], ['Financing', ['financing']],
    ]);
    expect(arrangeNav(ITEMS, prefs, { editing: true })[1].items.map((i) => i.value)).toEqual(['today', 'tasks']);
    expect(arrangeNav(ITEMS, 'garbage').length).toBe(3);
  });
  it('searches labels and keywords, label matches first, hidden pages included', () => {
    expect(searchNav(ITEMS, 'deals').map((i) => i.value)).toEqual(['financing']);
    expect(searchNav(ITEMS, 'pro').map((i) => i.value)).toEqual(['leads']);
    expect(searchNav(ITEMS, '')).toEqual([]);
  });
});

describe('NavMenu', () => {
  it('filters as you type, highlights, and Enter opens the first match', () => {
    const { container } = render(<Harness />);
    const box = screen.getByRole('searchbox', { name: 'Search menu' });
    fireEvent.change(box, { target: { value: 'deals' } });
    expect(labels(container)).toEqual(['Contracts · deals']);
    expect(container.querySelector('mark.mk-mark').textContent).toBe('deals');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('');
    expect(screen.getByRole('button', { name: 'Contracts' }).getAttribute('aria-current')).toBe('page');
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText(/No page matches/)).toBeTruthy();
  });

  it('stars a page into Favorites and saves it', async () => {
    const save = vi.fn();
    const { container } = render(<Harness save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Leads to favorites' }));
    expect(sections(container)[0]).toBe('Favorites');
    expect(labels(container).filter((l) => l === 'Leads').length).toBe(2);
    await act(async () => {});
    expect(save).toHaveBeenCalledWith('t.menu', { fav: ['leads'], order: {}, hidden: [] });
    expect(JSON.parse(localStorage.getItem('t.menu')).fav).toEqual(['leads']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Leads from favorites' })[0]);
    expect(sections(container)).not.toContain('Favorites');
  });

  it('edit mode moves within a section, hides, and resets', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Customers up' }));
    expect(labels(container)).toEqual(['Today', 'Tasks', 'Customers', 'Leads', 'Contracts']);
    expect(screen.getByRole('button', { name: 'Move Today up' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Tasks' }));
    expect(screen.getByRole('button', { name: 'Show Tasks' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(labels(container)).toEqual(['Today', 'Customers', 'Leads', 'Contracts']);
    // a hidden page is still found by search
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'tas' } });
    expect(labels(container)).toEqual(['Tasks']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset menu' }));
    expect(labels(container)).toEqual(['Today', 'Tasks', 'Leads', 'Customers', 'Contracts']);
    expect(localStorage.getItem('t.menu')).toBeNull();
  });

  it('loads the account copy over the browser copy', async () => {
    localStorage.setItem('t.menu', JSON.stringify({ fav: ['tasks'] }));
    const load = vi.fn().mockResolvedValue({ fav: ['customers'], order: { Sales: ['customers', 'leads'] } });
    const { container } = render(<Harness load={load} />);
    await act(async () => {});
    expect(load).toHaveBeenCalledWith('t.menu');
    expect(labels(container).slice(0, 1)).toEqual(['Customers']);
    expect(within(container.querySelector('[aria-label="Sales"]')).getAllByRole('button', { name: /^(Leads|Customers)/ }).map((b) => b.textContent)).toEqual(['Customers', 'Leads']);
  });

  it('⌘K and "/" focus the search and ask the shell to open', async () => {
    vi.useFakeTimers();
    const opened = vi.fn();
    window.addEventListener(SHELL_OPEN_EVENT, opened);
    render(<SidebarLayout sidebar={<Harness />}><p>Page</p></SidebarLayout>);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    act(() => { vi.advanceTimersByTime(50); });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    fireEvent.keyDown(document.activeElement, { key: '/' }); // typing "/" in the box is left alone
    expect(opened).toHaveBeenCalledTimes(1);
    document.activeElement.blur();
    fireEvent.keyDown(document, { key: '/' });
    expect(opened).toHaveBeenCalledTimes(2);
    window.removeEventListener(SHELL_OPEN_EVENT, opened);
    vi.useRealTimers();
  });
});
