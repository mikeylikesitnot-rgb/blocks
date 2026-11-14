import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import {
  SidebarLayout, NavList, InitialIcon, ThemeSwitch, initials, FilterMenu, filterSummary,
  GroupedList, highlight, useUrlList, useTheme,
} from '../src/index.js';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); try { localStorage.clear(); } catch { /* */ } });

const OPTS = [{ value: 'live', label: 'Live' }, { value: 'progress', label: 'In progress' }, { value: 'planned', label: 'Planned' }];

describe('highlight', () => {
  it('marks every typed word, case-insensitive', () => {
    const { container } = render(<p>{highlight('Sync all projects', 'SYNC proj')}</p>);
    expect([...container.querySelectorAll('mark.mk-mark')].map((m) => m.textContent)).toEqual(['Sync', 'proj']);
    expect(container.textContent).toBe('Sync all projects');
  });
  it('returns the plain string with no query or no match, and escapes regex', () => {
    expect(highlight('abc', '')).toBe('abc');
    expect(highlight('abc', 'zz')).toBe('abc');
    const { container } = render(<p>{highlight('cost (est.)', '(est.')}</p>);
    expect(container.querySelector('mark').textContent).toBe('(est.');
  });
});

describe('FilterMenu', () => {
  it('summarises the choice like a select', () => {
    expect(filterSummary('Status', OPTS, [], 'All statuses')).toBe('All statuses');
    expect(filterSummary('Status', OPTS, ['live', 'planned'])).toBe('Live, Planned');
    expect(filterSummary('Status', OPTS, ['live', 'planned', 'progress'])).toBe('Status: 3 selected');
  });

  function Harness() {
    const [v, setV] = useState([]);
    return <><FilterMenu label="Status" allLabel="All statuses" options={OPTS} value={v} onChange={setV} /><output>{v.join(',')}</output><button>outside</button></>;
  }

  it('stays open while ticking, keeps option order, clears, closes on Esc and outside click', () => {
    render(<Harness />);
    const btn = screen.getByRole('button', { name: 'All statuses' });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByLabelText('Planned'));
    fireEvent.click(screen.getByLabelText('Live'));
    expect(screen.getByRole('group', { name: 'Status' })).toBeTruthy();
    expect(document.querySelector('output').textContent).toBe('live,planned');
    expect(btn.className).toContain('mk-filter-btn-active');
    expect(btn.getAttribute('aria-label')).toBe('Status: Live, Planned');
    fireEvent.click(screen.getByLabelText('In progress'));
    expect(btn.getAttribute('aria-label')).toBeNull();
    expect(btn.textContent).toBe('Status: 3 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(document.querySelector('output').textContent).toBe('');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('says so when there is nothing to filter', () => {
    render(<FilterMenu label="Area" options={[]} value={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Area' }));
    expect(screen.getByText('Nothing to filter yet')).toBeTruthy();
  });
});

describe('useUrlList', () => {
  it('reads and writes a comma list in the URL', () => {
    window.history.replaceState(null, '', '/?status=live,planned');
    let api;
    function H() { api = useUrlList('status'); return null; }
    render(<H />);
    expect(api[0]).toEqual(['live', 'planned']);
    act(() => api[1](['progress']));
    expect(window.location.search).toBe('?status=progress');
    act(() => api[1]([]));
    expect(window.location.search).toBe('');
    expect(api[0]).toEqual([]);
  });
  it('returns the same array until the URL changes', () => {
    window.history.replaceState(null, '', '/?s=a,b');
    const seen = [];
    function H({ n }) { seen.push(useUrlList('s')[0]); return n; }
    const { rerender } = render(<H n={1} />);
    rerender(<H n={2} />);
    expect(seen[0]).toBe(seen[1]);
  });
});

describe('NavList', () => {
  it('marks the current item, renders sections and hot counts, and reports picks', () => {
    const picked = [];
    render(<NavList label="Projects" value="kit" onChange={(v) => picked.push(v)} items={[
      { value: '', label: 'All projects', count: 8 },
      { section: 'Projects', count: 2 },
      { value: 'kit', label: 'mn-kit', count: '1 building', hot: true },
      { value: 'hub', label: 'Project Hub', count: 0 },
    ]} />);
    expect(screen.getByRole('navigation', { name: 'Projects' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /mn-kit/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: /All projects/ }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('1 building').className).toContain('mk-nav-count-hot');
    expect(screen.getByText('0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Project Hub/ }));
    expect(picked).toEqual(['hub']);
  });
});

describe('InitialIcon', () => {
  it('uses capitals, else first letters, and wraps the colour', () => {
    expect(initials('Project Hub')).toBe('PH');
    expect(initials('mn-kit')).toBe('MN');
    const { container } = render(<><InitialIcon name="x" color={9} /><InitialIcon tone="ink">✱</InitialIcon></>);
    const [a, b] = container.querySelectorAll('.mk-initial');
    expect(a.style.background).toBe('var(--mk-cat-2)');
    expect(b.textContent).toBe('✱');
    expect(b.className).toContain('mk-initial-ink');
  });
});

describe('SidebarLayout', () => {
  it('opens the phone menu, closes on a nav pick and on Esc', () => {
    const { container } = render(
      <SidebarLayout brand="Hub" sidebar={<NavList items={[{ value: 'a', label: 'Alpha' }]} onChange={() => {}} />}>
        <p>Page</p>
      </SidebarLayout>,
    );
    const shell = container.querySelector('.mk-shell');
    const menu = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(menu);
    expect(shell.className).toContain('mk-shell-open');
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('main').hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(shell.className).not.toContain('mk-shell-open');
    expect(container.querySelector('main').hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(menu);
    fireEvent.click(menu);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(shell.className).not.toContain('mk-shell-open');
    expect(document.activeElement).toBe(menu);
    expect(screen.getByRole('main').textContent).toBe('Page');
  });
});

describe('ThemeSwitch', () => {
  it('stays in step with other useTheme users', () => {
    let api;
    function Other() { api = useTheme(); return null; }
    render(<><ThemeSwitch /><Other /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(api[0]).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    act(() => api[1]('system'));
    expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('GroupedList', () => {
  const groups = [
    { key: 'a', title: 'Alpha', note: '1 shown', items: [{ key: 1, id: 'F-001', badge: <span>Live</span>, title: 'Sync all', description: 'Sync every project', aside: ['Sync', '2026-11-13'] }] },
    { key: 'b', title: 'Beta', items: [] },
  ];
  it('renders headings, rows, side cells and highlights; skips empty groups', () => {
    const { container } = render(<GroupedList label="Features" query="sync" columns={['ID', 'Status', 'Feature', 'Area', 'Since']} groups={groups} />);
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Beta' })).toBeNull();
    expect(container.querySelectorAll('.mk-glist-aside')).toHaveLength(2);
    expect(container.querySelectorAll('mark').length).toBe(3);
    expect(container.querySelector('.mk-glist').style.getPropertyValue('--mk-glist-cols')).toContain('repeat(2,');
  });
  it('has loading, error and default empty states', () => {
    const { rerender } = render(<GroupedList groups={[]} loading />);
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    let retried = 0;
    rerender(<GroupedList groups={[]} error="Server said no" onRetry={() => { retried += 1; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retried).toBe(1);
    rerender(<GroupedList groups={[]} />);
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
  });
  it('names side cells for screen readers', () => {
    const { container } = render(<GroupedList columns={['ID', 'Status', 'Feature', 'Area']} groups={[{ key: 'a', items: [{ id: 'F-1', title: 'T', aside: ['Sync'] }] }]} />);
    expect(container.querySelector('.mk-glist-aside').textContent).toBe('Area: Sync');
  });
  it('shows `empty` when nothing is left', () => {
    render(<GroupedList groups={[{ key: 'b', title: 'Beta', items: [] }]} columns={['ID']} empty={<p>No features match</p>} />);
    expect(screen.getByText('No features match')).toBeTruthy();
    expect(document.querySelector('.mk-glist-head')).toBeNull();
  });
});
