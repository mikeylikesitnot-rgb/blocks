import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { Changelog, CompareImages, normalizeChangelog, changelogDay, OverlayProvider } from '../src/index.js';

afterEach(cleanup);

const REPO = 'https://github.com/me/app';
const RAW = {
  entries: [
    { id: 'a', date: '2026-11-18', type: 'bug', title: 'Deploy deletes old files', links: { commit: 'b8c3bd5' } },
    { id: 'b', date: '2026-11-20', type: 'feat', feature: 'F-089', title: 'Leads link to the car', summary: 'See the car before you call.',
      links: { page: 'https://x.com/admin?tab=leads', commit: '486dd01aa', pr: 42 },
      shots: [{ label: 'Leads list', before: 'f089-before.webp', after: 'f089-after.webp' }] },
    { id: 'c', date: '2026-11-20', type: 'changed', title: 'Search on its own row', shots: [{ after: '/abs/after.webp' }] },
  ],
};

describe('normalizeChangelog', () => {
  it('drops entries without a title or a real date, and junk', () => {
    const out = normalizeChangelog([
      { date: '2026-11-20', title: 'ok' }, { date: 'yesterday', title: 'no' }, { date: '2026-02-30x', title: 'no' },
      { date: '2026-11-20' }, null, 'x', { date: '2026-11-20', title: '   ' },
    ]);
    expect(out.map((e) => e.title)).toEqual(['ok']);
  });
  it('accepts an array or { entries }, and anything else is empty', () => {
    expect(normalizeChangelog([{ date: '2026-01-01', title: 't' }])).toHaveLength(1);
    expect(normalizeChangelog({ entries: [{ date: '2026-01-01', title: 't' }] })).toHaveLength(1);
    expect(normalizeChangelog(null)).toEqual([]);
    expect(normalizeChangelog({ nope: 1 })).toEqual([]);
  });
  it('maps type words and defaults unknown ones to improvement', () => {
    const out = normalizeChangelog(['feat', 'Fixed', 'bug', 'perf', 'whatever', undefined].map((type, i) => ({ date: '2026-01-01', title: `t${i}`, type })));
    expect(out.map((e) => e.type)).toEqual(['feature', 'fix', 'fix', 'improvement', 'improvement', 'improvement']);
  });
  it('sorts newest first and keeps file order within a day', () => {
    expect(normalizeChangelog(RAW).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });
  it('turns hashes and PR numbers into links with repoUrl, and keeps full URLs', () => {
    const [b, , a] = normalizeChangelog(RAW, { repoUrl: `${REPO}/` });
    expect(b.links.commit).toEqual({ href: `${REPO}/commit/486dd01aa`, label: 'Commit 486dd01' });
    expect(b.links.pr).toEqual({ href: `${REPO}/pull/42`, label: 'PR #42' });
    expect(a.links.pr).toBeNull();
    const [u] = normalizeChangelog([{ date: '2026-01-01', title: 't', links: { commit: `${REPO}/commit/abcdef1234`, pr: `${REPO}/pull/7` } }]);
    expect(u.links.commit.label).toBe('Commit abcdef1');
    expect(u.links.pr.label).toBe('PR #7');
  });
  it('makes no link from a bare hash without repoUrl, or from a non-hash', () => {
    const [e] = normalizeChangelog([{ date: '2026-01-01', title: 't', links: { commit: '486dd01', pr: 'soon' } }]);
    expect(e.links.commit).toBeNull();
    expect(e.links.pr).toBeNull();
  });
  it('only allows http(s) or same-site page links', () => {
    const out = normalizeChangelog(['javascript:alert(1)', '/admin?tab=leads', '//evil.com', '/\\evil.com', 'https://x.com/a']
      .map((page, i) => ({ date: '2026-01-01', title: `t${i}`, links: { page } })));
    expect(out.map((e) => e.links.page)).toEqual([null, '/admin?tab=leads', null, null, 'https://x.com/a']);
  });
  it('ignores a repoUrl that is not http(s)', () => {
    const [e] = normalizeChangelog([{ date: '2026-01-01', title: 't', links: { commit: '486dd01', pr: 3 } }], { repoUrl: 'javascript:alert(1)' });
    expect(e.links.commit).toBeNull();
    expect(e.links.pr).toBeNull();
  });
  it('returns its own output unchanged, so links and relative image paths survive a second pass', () => {
    const once = normalizeChangelog(RAW, { baseUrl: 'changelog/', repoUrl: REPO });
    const twice = normalizeChangelog(once, { baseUrl: 'changelog/', repoUrl: REPO });
    expect(twice).toBe(once);
    expect(twice[0].links.commit.href).toBe(`${REPO}/commit/486dd01aa`);
    expect(twice[0].shots[0].before).toBe('changelog/f089-before.webp');
    // a copy (e.g. from JSON) keeps built links too
    const [copy] = normalizeChangelog(JSON.parse(JSON.stringify(once)));
    expect(copy.links.pr).toEqual({ href: `${REPO}/pull/42`, label: 'PR #42' });
  });
  it('resolves image paths against baseUrl and drops empty shots', () => {
    const out = normalizeChangelog(RAW, { baseUrl: '/changelog/' });
    expect(out[0].shots).toEqual([{ label: 'Leads list', before: '/changelog/f089-before.webp', after: '/changelog/f089-after.webp' }]);
    expect(out[1].shots[0]).toEqual({ label: '', before: null, after: '/abs/after.webp' });
    const [e] = normalizeChangelog([{ date: '2026-01-01', title: 't', shots: [{ label: 'x' }, null] }]);
    expect(e.shots).toEqual([]);
  });
  it('gives missing and repeated ids a unique one', () => {
    const ids = normalizeChangelog([{ date: '2026-01-01', title: 'a' }, { id: 'x', date: '2026-01-01', title: 'b' }, { id: 'x', date: '2026-01-01', title: 'c' }]).map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('changelogDay', () => {
  it('formats the day without shifting it by time zone', () => {
    expect(changelogDay('2026-11-20')).toBe('Fri, Nov 20, 2026');
  });
});

const view = (props = {}) => render(<OverlayProvider><Changelog entries={RAW} repoUrl={REPO} baseUrl="/changelog/" {...props} /></OverlayProvider>);

it('Changelog keeps Commit and PR links when given normalizeChangelog output', () => {
  render(<OverlayProvider><Changelog entries={normalizeChangelog(RAW, { repoUrl: REPO })} repoUrl={REPO} /></OverlayProvider>);
  expect(screen.getByRole('link', { name: 'PR #42' })).toBeTruthy();
  expect(screen.getAllByRole('link', { name: /^Commit/ })).toHaveLength(2);
});

describe('Changelog', () => {
  it('groups by day, newest first, with badge, F-id, title and summary', () => {
    view();
    const days = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(days).toEqual(['Fri, Nov 20, 2026', 'Wed, Nov 18, 2026']);
    const first = screen.getByRole('region', { name: 'Fri, Nov 20, 2026' });
    expect(within(first).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Leads link to the car', 'Search on its own row']);
    expect(within(first).getByText('New')).toBeTruthy();
    expect(within(first).getByText('Improved')).toBeTruthy();
    expect(within(first).getByText('F-089')).toBeTruthy();
    expect(within(first).getByText('See the car before you call.')).toBeTruthy();
    expect(screen.getByText('Fixed')).toBeTruthy();
  });
  it('shows only the links an entry has, opening in a new tab', () => {
    view();
    const page = screen.getByRole('link', { name: 'Open page' });
    expect(page.getAttribute('href')).toBe('https://x.com/admin?tab=leads');
    expect(page.getAttribute('target')).toBe('_blank');
    expect(page.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: 'PR #42' }).getAttribute('href')).toBe(`${REPO}/pull/42`);
    expect(screen.getAllByRole('link', { name: 'Open page' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /^Commit/ })).toHaveLength(2);
  });
  it('filters by type and searches title, summary and F-id with highlighting', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: /All types/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Fixed/ }));
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Deploy deletes old files']);
    fireEvent.click(screen.getByRole('checkbox', { name: /Fixed/ }));
    fireEvent.change(screen.getByPlaceholderText('Search changes'), { target: { value: 'f-089' } });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Leads link to the car']);
    expect(document.querySelector('mark.mk-mark')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });
  it('shows Clear filters when nothing matches, and it clears search and type', () => {
    view();
    fireEvent.change(screen.getByPlaceholderText('Search changes'), { target: { value: 'zzzz' } });
    expect(screen.getByText('Nothing matches these filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });
  it('has loading, empty and error states', () => {
    const { rerender } = view({ entries: [], loading: true });
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    rerender(<OverlayProvider><Changelog entries={[]} /></OverlayProvider>);
    expect(screen.getByText('No changes yet')).toBeTruthy();
    let retried = false;
    rerender(<OverlayProvider><Changelog entries={[]} error="404" onRetry={() => { retried = true; }} /></OverlayProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retried).toBe(true);
  });
  it('can be controlled from outside', () => {
    let q = null;
    view({ query: 'deploy', onQueryChange: (v) => { q = v; } });
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText('Search changes'), { target: { value: 'x' } });
    expect(q).toBe('x');
  });
});

describe('CompareImages', () => {
  const cmp = (props) => render(<OverlayProvider><CompareImages before="/b.webp" after="/a.webp" label="Leads list" {...props} /></OverlayProvider>);

  it('slider moves with the range input (keyboard and touch use the same input)', () => {
    cmp();
    const range = screen.getByLabelText(/drag to compare/);
    expect(range.getAttribute('type')).toBe('range');
    fireEvent.change(range, { target: { value: '30' } });
    expect(document.querySelector('.mk-compare-slider').style.getPropertyValue('--mk-compare-pos')).toBe('30%');
    expect(range.getAttribute('aria-valuetext')).toBe('30% before, 70% after');
  });
  it('switches to side by side, and an image opens full size with a toggle to the other', () => {
    cmp();
    fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Leads list: After full size' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe('/a.webp');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show before' }));
    expect(within(screen.getByRole('dialog')).getByRole('img').getAttribute('src')).toBe('/b.webp');
  });
  it('dragging puts the line where the pointer is', () => {
    cmp();
    const box = document.querySelector('.mk-compare-slider');
    box.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 300, right: 500, bottom: 300 });
    // jsdom has no PointerEvent; a MouseEvent with the pointer event's name carries clientX.
    const fire = (type, clientX) => fireEvent(box, new MouseEvent(type, { bubbles: true, clientX }));
    fire('pointerdown', 200);
    expect(box.style.getPropertyValue('--mk-compare-pos')).toBe('25%');
    fire('pointermove', 900);
    expect(box.style.getPropertyValue('--mk-compare-pos')).toBe('100%');
    fire('pointerup', 900);
    fire('pointermove', 100);
    expect(box.style.getPropertyValue('--mk-compare-pos')).toBe('100%');
  });
  it('slider mode has Open buttons for each image', () => {
    cmp();
    fireEvent.click(screen.getByRole('button', { name: 'Open before' }));
    expect(within(screen.getByRole('dialog')).getByRole('img').getAttribute('src')).toBe('/b.webp');
  });
  it('shows a single image alone, without the view switch', () => {
    cmp({ before: null });
    expect(screen.queryByRole('button', { name: 'Slider' })).toBeNull();
    expect(screen.queryByLabelText(/drag to compare/)).toBeNull();
    expect(screen.getByRole('img', { name: 'Leads list: After' })).toBeTruthy();
  });
});
