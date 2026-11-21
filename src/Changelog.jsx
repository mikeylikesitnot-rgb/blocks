import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from './cx.js';
import { Badge } from './Badge.jsx';
import { Button } from './Button.jsx';
import { Segmented, Toolbar } from './Layout.jsx';
import { SearchInput } from './Inputs.jsx';
import { FilterMenu } from './FilterMenu.jsx';
import { EmptyState, SkeletonRows } from './States.jsx';
import { Lightbox } from './Attachments.jsx';
import { matchesQuery } from './search.js';
import { highlight } from './highlight.jsx';

/* ───────── Changelog ─────────
   What changed in an app, newest first: features, fixes and improvements,
   each with links (live page, commit, PR) and before/after screenshots.
   UI only: the app serves its changelog.json and the images.
     const raw = await fetch('/changelog.json').then((r) => r.json());
     <Changelog entries={raw} baseUrl="/changelog/" repoUrl="https://github.com/me/app" />
   Entry: { id, date: 'YYYY-MM-DD', type: 'feature'|'fix'|'improvement', title, summary,
            feature: 'F-089', links: { page, commit, pr }, shots: [{ label, before, after }] } */

export const CHANGE_TYPES = {
  feature: { label: 'New', tone: 'success' },
  fix: { label: 'Fixed', tone: 'accent' },
  improvement: { label: 'Improved', tone: 'info' },
};

const TYPE_ALIASES = {
  feature: 'feature', feat: 'feature', new: 'feature', added: 'feature', add: 'feature',
  fix: 'fix', fixed: 'fix', bug: 'fix', bugfix: 'fix',
  improvement: 'improvement', improved: 'improvement', improve: 'improvement', change: 'improvement', changed: 'improvement', perf: 'improvement',
};

// A real calendar day: Date rolls 2026-02-30 over to March 2, so check the round trip.
const isDay = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const isAbsolute = (p) => /^([a-z][a-z0-9+.-]*:|\/)/i.test(p);

/** Resolve an image path against baseUrl ("/changelog/" + "a.webp"); absolute paths and URLs stay. */
function resolvePath(p, baseUrl) {
  const s = str(p);
  if (!s) return null;
  if (isAbsolute(s) || !baseUrl) return s;
  return `${baseUrl.replace(/\/+$/, '')}/${s.replace(/^\.?\/+/, '')}`;
}

const repoBase = (repoUrl) => { const r = str(repoUrl).replace(/\/+$/, ''); return /^https?:\/\//i.test(r) ? r : ''; };
// An already-built { href, label } (from normalizeChangelog's own output) passes through if it is http(s).
const builtLink = (v) => (v && typeof v === 'object' && /^https?:\/\//i.test(str(v.href)) ? { href: str(v.href), label: str(v.label) || 'Link' } : null);

/** A commit hash or URL -> { href, label }. A bare hash needs repoUrl to become a link. */
function commitLink(v, repoUrl) {
  if (v && typeof v === 'object') return builtLink(v);
  const s = str(v);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    const sha = s.match(/\/commit\/([0-9a-f]{7,40})/i)?.[1];
    return { href: s, label: sha ? `Commit ${sha.slice(0, 7)}` : 'Commit' };
  }
  if (!/^[0-9a-f]{7,40}$/i.test(s)) return null;
  const repo = repoBase(repoUrl);
  return repo ? { href: `${repo}/commit/${s}`, label: `Commit ${s.slice(0, 7)}` } : null;
}

/** A PR number ("12", 12, "#12") or URL -> { href, label }. */
function prLink(v, repoUrl) {
  if (v && typeof v === 'object') return builtLink(v);
  const s = str(v);
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    const n = s.match(/\/pull\/(\d+)/)?.[1];
    return { href: s, label: n ? `PR #${n}` : 'PR' };
  }
  const n = s.replace(/^#/, '');
  if (!/^\d+$/.test(n)) return null;
  const repo = repoBase(repoUrl);
  return repo ? { href: `${repo}/pull/${n}`, label: `PR #${n}` } : null;
}

/**
 * Clean up a changelog file: takes an array or { entries: [...] }, drops
 * entries without a title or a YYYY-MM-DD date, maps type words ("feat",
 * "bug", "changed") to feature | fix | improvement, turns commit hashes and
 * PR numbers into links (with repoUrl), resolves image paths against baseUrl,
 * and sorts newest first (same-day entries keep the file's order).
 */
const NORMALIZED = Symbol('mk-changelog');

export function normalizeChangelog(raw, { baseUrl = '', repoUrl = '' } = {}) {
  if (raw && raw[NORMALIZED]) return raw; // already clean: don't resolve image paths twice
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];
  const seen = new Set();
  const out = [];
  list.forEach((e, i) => {
    if (!e || typeof e !== 'object') return;
    const title = str(e.title);
    const date = str(e.date).slice(0, 10);
    if (!title || !isDay(date)) return;
    let id = str(e.id) || `${date}-${i + 1}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    const links = e.links && typeof e.links === 'object' ? e.links : {};
    const page = str(links.page);
    const shots = (Array.isArray(e.shots) ? e.shots : [])
      .map((s) => (s && typeof s === 'object' ? {
        label: str(s.label),
        before: resolvePath(s.before, baseUrl),
        after: resolvePath(s.after, baseUrl),
      } : null))
      .filter((s) => s && (s.before || s.after));
    out.push({
      id,
      date,
      type: TYPE_ALIASES[str(e.type).toLowerCase()] || 'improvement',
      title,
      summary: str(e.summary),
      feature: str(e.feature),
      links: {
        page: page && /^(https?:\/\/|\/(?![/\\]))/i.test(page) ? page : null,
        commit: commitLink(links.commit, repoUrl),
        pr: prLink(links.pr, repoUrl),
      },
      shots,
      _order: i,
    });
  });
  out.sort((a, b) => (a.date === b.date ? a._order - b._order : a.date < b.date ? 1 : -1));
  const result = out.map(({ _order, ...e }) => e);
  Object.defineProperty(result, NORMALIZED, { value: true });
  return result;
}

/** "Fri, Nov 20, 2026" for a YYYY-MM-DD day, in UTC so it never shifts a day. */
export function changelogDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Before/after screenshots. Slider (drag, or arrow keys on the handle) or
 * side by side; either image opens full size in a Lightbox. With only one
 * image it shows that one.
 *   <CompareImages before="/c/a-before.webp" after="/c/a-after.webp" label="Leads list" />
 */
export function CompareImages({ before, after, label = '', beforeLabel = 'Before', afterLabel = 'After', defaultMode = 'slider', className = '' }) {
  const [mode, setMode] = useState(defaultMode === 'side' ? 'side' : 'slider');
  const [pos, setPos] = useState(50);
  const [open, setOpen] = useState(null); // 'before' | 'after'
  const sliderId = useId();
  const box = useRef(null);
  const dragging = useRef(false);
  // Pointer drag sets the line exactly under the finger; the hidden range input is for keyboard and screen readers.
  const moveTo = (clientX) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width || !Number.isFinite(clientX)) return;
    setPos(Math.round(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100))));
  };
  const pointer = {
    onPointerDown: (e) => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); moveTo(e.clientX); },
    onPointerMove: (e) => { if (dragging.current) moveTo(e.clientX); },
    onPointerUp: () => { dragging.current = false; },
    onPointerCancel: () => { dragging.current = false; },
  };
  const name = label ? `${label}: ` : '';
  const srcs = { before, after };
  const tags = { before: beforeLabel, after: afterLabel };
  const both = Boolean(before && after);
  useEffect(() => { if (open && !srcs[open]) setOpen(null); }, [open, before, after]); // eslint-disable-line react-hooks/exhaustive-deps

  const thumb = (which) => (
    <figure className="mk-compare-fig">
      <button type="button" className="mk-compare-img-btn" onClick={() => setOpen(which)} aria-label={`Open ${name}${tags[which]} full size`}>
        <img src={srcs[which]} alt={`${name}${tags[which]}`} loading="lazy" />
      </button>
      <figcaption className="mk-compare-tag">{tags[which]}</figcaption>
    </figure>
  );

  return (
    <div className={cx('mk-compare', className)}>
      {(label || both) && (
        <div className="mk-compare-head">
          {label && <span className="mk-compare-label">{label}</span>}
          {both && (
            <Segmented label={`${name}compare view`} value={mode} onChange={setMode}
              items={[{ value: 'slider', label: 'Slider' }, { value: 'side', label: 'Side by side' }]} />
          )}
        </div>
      )}

      {!both && thumb(before ? 'before' : 'after')}

      {both && mode === 'side' && (
        <div className="mk-compare-side">{thumb('before')}{thumb('after')}</div>
      )}

      {both && mode === 'slider' && (
        <>
          <div ref={box} className="mk-compare-slider" style={{ '--mk-compare-pos': `${pos}%` }} {...pointer}>
            <img className="mk-compare-after" src={after} alt={`${name}${beforeLabel} and ${afterLabel}`} loading="lazy" draggable="false" />
            <img className="mk-compare-before" src={before} alt="" loading="lazy" draggable="false" />
            <span className="mk-compare-line" aria-hidden />
            <span className="mk-compare-tag mk-compare-tag-l" aria-hidden>{beforeLabel}</span>
            <span className="mk-compare-tag mk-compare-tag-r" aria-hidden>{afterLabel}</span>
            <label htmlFor={sliderId} className="mk-sr-only">{`${name}drag to compare ${beforeLabel} and ${afterLabel}`}</label>
            <input
              id={sliderId}
              type="range"
              min="0"
              max="100"
              step="1"
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              aria-valuetext={`${pos}% ${beforeLabel.toLowerCase()}, ${100 - pos}% ${afterLabel.toLowerCase()}`}
              className="mk-compare-range mk-sr-only"
            />
          </div>
          <div className="mk-compare-open">
            <Button variant="ghost" size="xs" onClick={() => setOpen('before')}>Open {beforeLabel.toLowerCase()}</Button>
            <Button variant="ghost" size="xs" onClick={() => setOpen('after')}>Open {afterLabel.toLowerCase()}</Button>
          </div>
        </>
      )}

      <Lightbox
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        src={open ? srcs[open] : null}
        alt={open ? `${name}${tags[open]}` : ''}
        footer={both && open ? (
          <Button variant="secondary" size="sm" onClick={() => setOpen(open === 'before' ? 'after' : 'before')}>
            Show {(open === 'before' ? afterLabel : beforeLabel).toLowerCase()}
          </Button>
        ) : null}
      />
    </div>
  );
}

function Entry({ e, query, anchor }) {
  const t = CHANGE_TYPES[e.type];
  const { page, commit, pr } = e.links;
  return (
    <article className="mk-cl-entry" id={anchor}>
      <div className="mk-cl-meta">
        <Badge tone={t.tone}>{t.label}</Badge>
        {e.feature && <span className="mk-cl-id">{highlight(e.feature, query)}</span>}
      </div>
      <h3 className="mk-cl-title">{highlight(e.title, query)}</h3>
      {e.summary && <p className="mk-cl-summary">{highlight(e.summary, query)}</p>}
      {(page || commit || pr) && (
        <div className="mk-cl-links">
          {page && <Button variant="soft" size="xs" href={page} target="_blank" rel="noopener noreferrer">Open page</Button>}
          {commit && <Button variant="ghost" size="xs" href={commit.href} target="_blank" rel="noopener noreferrer">{commit.label}</Button>}
          {pr && <Button variant="ghost" size="xs" href={pr.href} target="_blank" rel="noopener noreferrer">{pr.label}</Button>}
        </div>
      )}
      {e.shots.length > 0 && (
        <div className="mk-cl-shots">
          {e.shots.map((s, i) => (
            <CompareImages key={`${s.before}|${s.after}|${i}`} before={s.before} after={s.after} label={s.label || (e.shots.length > 1 ? `Screen ${i + 1}` : '')} />
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * The changelog page body: type filter + search over a day-grouped list.
 * `entries` is the raw file (normalized here) or normalizeChangelog's output.
 * Filters are internal unless you pass query/onQueryChange and
 * types/onTypesChange (e.g. from useSavedFilters or useUrlList).
 * toolbar={false} hides the built-in search + Type filter so the app can use
 * its own filter row (still pass query/types so the list follows it).
 */
export function Changelog({
  entries, baseUrl, repoUrl, loading = false, error = null, onRetry,
  query: queryProp, onQueryChange, types: typesProp, onTypesChange,
  empty, toolbar = true, toolbarRight, anchorPrefix, className = '',
}) {
  const [qState, setQState] = useState('');
  const [tState, setTState] = useState([]);
  const query = queryProp ?? qState;
  const types = typesProp ?? tState;
  const setQuery = onQueryChange || setQState;
  const setTypes = onTypesChange || setTState;

  const all = useMemo(() => normalizeChangelog(entries, { baseUrl, repoUrl }), [entries, baseUrl, repoUrl]);
  const shown = useMemo(() => all.filter((e) => (!types.length || types.includes(e.type))
    && matchesQuery(query, [e.title, e.summary, e.feature])), [all, types, query]);
  const days = useMemo(() => {
    const m = new Map();
    for (const e of shown) { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date).push(e); }
    return [...m];
  }, [shown]);
  const options = Object.entries(CHANGE_TYPES).map(([value, t]) => ({ value, label: t.label, count: all.filter((e) => e.type === value).length }));
  const filtered = Boolean(query) || types.length > 0;
  const clear = () => { setQuery(''); setTypes([]); };

  let body;
  if (loading && !all.length) body = <SkeletonRows rows={4} cols={2} />;
  else if (error && !all.length) body = <EmptyState variant="error" body={typeof error === 'string' ? error : error.message} onRetry={onRetry} />;
  else if (!all.length) body = <EmptyState title={empty?.title || 'No changes yet'} body={empty?.body || 'Shipped features and fixes will show up here.'} />;
  else if (!shown.length) body = <EmptyState variant="filtered" onClear={clear} />;
  else {
    body = days.map(([day, list]) => (
      <section key={day} className="mk-cl-day" aria-label={changelogDay(day)}>
        <h2 className="mk-eyebrow mk-cl-day-title"><time dateTime={day}>{changelogDay(day)}</time></h2>
        <div className="mk-cl-list">{list.map((e) => <Entry key={e.id} e={e} query={query} anchor={anchorPrefix ? `${anchorPrefix}${e.id}` : undefined} />)}</div>
      </section>
    ));
  }

  return (
    <div className={cx('mk-cl', className)}>
      {toolbar && (
        <Toolbar right={toolbarRight ?? (all.length ? `${shown.length} of ${all.length}` : null)}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search changes" />
          <FilterMenu label="Type" allLabel="All types" options={options} value={types} onChange={setTypes} />
        </Toolbar>
      )}
      {body}
    </div>
  );
}
