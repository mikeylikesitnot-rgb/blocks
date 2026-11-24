import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
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
      ['\u0000fav', ['financing']], ['Daily', ['today']], ['Sales', ['customers', 'leads']], ['Financing', ['financing']],
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
    fireEvent.click(screen.getByRole('button', { name: 'Favorite Leads', pressed: false }));
    expect(sections(container)[0]).toBe('Favorites');
    expect(labels(container).filter((l) => l === 'Leads').length).toBe(2);
    await act(async () => {});
    expect(save).toHaveBeenCalledWith('t.menu', { fav: ['leads'], order: {}, hidden: [] });
    expect(JSON.parse(localStorage.getItem('t.menu')).fav).toEqual(['leads']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Favorite Leads', pressed: true })[0]);
    expect(sections(container)).not.toContain('Favorites');
  });

  it('edit mode moves within a section, hides, and resets', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Customers up' }));
    expect(labels(container)).toEqual(['Today', 'Tasks', 'Customers', 'Leads', 'Contracts']);
    expect(screen.getByRole('button', { name: 'Move Today up' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Tasks' }));
    expect(screen.getByRole('button', { name: 'Hide Tasks' }).getAttribute('aria-pressed')).toBe('true');
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

  it('edit mode can be driven from outside; editButton and hint can be turned off', () => {
    function Outside() {
      const [on, setOn] = useState(false);
      return (<>
        <Harness editing={on} onEditingChange={setOn} editButton={false} hint={false} />
        <button type="button" onClick={() => setOn(true)}>Outside edit</button>
      </>);
    }
    const { container } = render(<Outside />);
    expect(screen.queryByRole('button', { name: 'Edit menu' })).toBeNull();
    expect(container.textContent).not.toMatch(/Tip: star/);
    fireEvent.click(screen.getByRole('button', { name: 'Outside edit' }));
    expect(screen.getByRole('button', { name: 'Move Customers up' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move Customers up' })).toBeNull();
  });

  it('shows the Edit menu button and star tip by default', () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('button', { name: 'Edit menu' })).toBeTruthy();
    expect(container.textContent).toMatch(/Tip: star a page/);
  });

  it('loads the account copy over the browser copy', async () => {
    localStorage.setItem('t.menu', JSON.stringify({ fav: ['tasks'] }));
    const load = vi.fn().mockResolvedValue({ fav: ['customers'], order: { Sales: ['customers', 'leads'] } });
    const { container } = render(<Harness load={load} />);
    await act(async () => {});
    expect(load).toHaveBeenCalledWith('t.menu');
    expect(labels(container).slice(0, 1)).toEqual(['Customers']);
    expect([...container.querySelectorAll('[aria-label="Sales"] .mk-nav-item')].map((b) => b.textContent)).toEqual(['Customers', 'Leads']);
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

  it('a string shortcut uses only ⌘/Ctrl + that key, leaving ⌘K and "/" to the app', () => {
    const opened = vi.fn();
    window.addEventListener(SHELL_OPEN_EVENT, opened);
    render(<Harness shortcut="/" />);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    fireEvent.keyDown(document, { key: '/' });
    expect(opened).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: '/', ctrlKey: true });
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener(SHELL_OPEN_EVENT, opened);
  });

  it('shows an item with no value (an action) without crashing, and never stars it', () => {
    const signOut = vi.fn();
    render(<NavMenu prefKey="t.act" items={[...ITEMS, { label: 'Sign out', onClick: signOut }]} value="today" onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Favorite Sign out' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });

  it('searches `text` when the label is not a string', () => {
    const { container } = render(<NavMenu prefKey="t.txt" value="" onChange={() => {}} items={[{ value: 'x', label: <b>Fancy</b>, text: 'Fancy page' }]} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'obj' } });
    expect(screen.getByText(/No page matches/)).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'fan' } });
    expect(container.querySelector('.mk-nav-item b').textContent).toBe('Fancy');
    expect(screen.getByRole('status').textContent).toBe('1 page');
  });

  it('Enter clicks the first result: follows links and closes the phone menu', () => {
    const clicked = vi.fn((e) => e.preventDefault());
    const { container } = render(
      <SidebarLayout sidebar={<NavMenu prefKey="t.href" value="" items={[{ value: 'docs', label: 'Docs', href: '/docs' }]} />}><p>Page</p></SidebarLayout>,
    );
    container.querySelector('a.mk-nav-item').addEventListener('click', clicked);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'doc' } });
    container.querySelector('a.mk-nav-item').addEventListener('click', clicked);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(clicked).toHaveBeenCalled();
    expect(container.querySelector('.mk-shell').className).not.toContain('mk-shell-open');
  });

  it('Esc in the search clears it without closing the phone menu', () => {
    const { container } = render(<SidebarLayout sidebar={<Harness />}><p>Page</p></SidebarLayout>);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'lea' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('');
    expect(container.querySelector('.mk-shell').className).toContain('mk-shell-open');
  });

  it('keeps focus on the arrow after a move, and on the other arrow at the end', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit menu' }));
    const down = screen.getByRole('button', { name: 'Move Leads down' });
    down.focus();
    fireEvent.click(down);
    await act(async () => { await new Promise((r) => requestAnimationFrame(r)); });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Leads up' }));
  });

  it('moving favorites keeps starred pages that are not on screen', async () => {
    localStorage.setItem('t.menu', JSON.stringify({ fav: ['leads', 'secret', 'today'] }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit menu' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Move Today up' })[0]);
    expect(JSON.parse(localStorage.getItem('t.menu')).fav).toEqual(['today', 'leads', 'secret']);
  });

  it('a keydown with no key (autofill) does not throw', () => {
    render(<Harness />);
    expect(() => fireEvent.keyDown(document, {})).not.toThrow();
  });

  it('a count with a note gets a tooltip and screen-reader text', () => {
    const { container } = render(<NavMenu items={[{ value: 'a', label: 'Leads', count: 3, hot: true, note: '3 waiting over 2 hours' }]} value="a" onChange={() => {}} />);
    const count = container.querySelector('.mk-nav-count');
    expect(count.getAttribute('title')).toBe('3 waiting over 2 hours');
    expect(count.className).toContain('mk-nav-count-hot');
    expect(count.querySelector('.mk-sr-only').textContent).toBe(' (3 waiting over 2 hours)');
    expect(screen.getByRole('button', { name: /Leads 3 \(3 waiting over 2 hours\)/ })).toBeTruthy();
  });
});

describe('NavMenu searchExtra', () => {
  const recs = (q) => Promise.resolve(q.startsWith('ver') ? [
    { section: 'Cars', items: [{ key: 25, label: '#25 2017 Nissan Versa', detail: 'YPP3474 · Snooze', href: '/fleet/25' }], more: { label: 'See all cars', href: '/fleet?q=ver' } },
    { section: 'Trips', items: [] },
  ] : []);

  it('shows record results under page matches after the delay, skips empty sections', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn(recs);
      const { container } = render(<Harness searchExtra={fn} searchDelay={200} />);
      const box = screen.getByRole('searchbox', { name: 'Search menu' });
      fireEvent.change(box, { target: { value: 'v' } });
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(fn).not.toHaveBeenCalled(); // below searchMin
      fireEvent.change(box, { target: { value: 'vers' } });
      expect(container.textContent).toContain('Searching…');
      await act(async () => { vi.advanceTimersByTime(250); });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0][0]).toBe('vers');
      expect(sections(container)).toEqual(['Cars']);
      const link = container.querySelector('a.mk-nav-result');
      expect(link.getAttribute('href')).toBe('/fleet/25');
      expect(link.textContent).toContain('YPP3474');
      expect(container.querySelector('a.mk-nav-more').textContent).toBe('See all cars');
      expect(screen.getByRole('status').textContent).toBe('0 pages, 1 more results');
    } finally { vi.useRealTimers(); }
  });

  it('Enter opens the first record when no page matches; arrows and Esc work', async () => {
    vi.useFakeTimers();
    try {
      const onClick = vi.fn((e) => e.preventDefault());
      const fn = () => Promise.resolve([{ section: 'Cars', items: [{ key: 1, label: 'Versa', onClick }] }]);
      render(<Harness searchExtra={fn} />);
      const box = screen.getByRole('searchbox', { name: 'Search menu' });
      fireEvent.change(box, { target: { value: 'versa' } });
      await act(async () => { vi.advanceTimersByTime(250); });
      fireEvent.keyDown(box, { key: 'ArrowDown' });
      expect(document.activeElement.textContent).toBe('Versa');
      fireEvent.keyDown(document.activeElement, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(box);
      fireEvent.keyDown(box, { key: 'Enter' });
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(box.value).toBe('');
      fireEvent.change(box, { target: { value: 'versa' } });
      fireEvent.keyDown(box, { key: 'Escape' });
      expect(box.value).toBe('');
    } finally { vi.useRealTimers(); }
  });

  it('says so when the record search fails', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<Harness searchExtra={() => Promise.reject(new Error('x'))} />);
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search menu' }), { target: { value: 'zz' } });
      await act(async () => { vi.advanceTimersByTime(250); });
      expect(container.textContent).toContain("Couldn't search records");
    } finally { vi.useRealTimers(); }
  });
});
