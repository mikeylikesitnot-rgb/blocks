import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from './cx.js';
import { Button } from './Button.jsx';
import { SearchInput } from './Inputs.jsx';
import { matchesQuery } from './search.js';
import { highlight } from './highlight.jsx';
import { NavCount } from './NavCount.jsx';
import { useSavedPref } from './savedPref.js';
import { orderColumns } from './ColumnOrder.jsx';
import { ArrowUpIcon, ArrowDownIcon, GripIcon, StarIcon, EyeIcon, EyeOffIcon } from './icons.jsx';

/** Tells SidebarLayout to open its phone menu (NavMenu sends it for its search shortcut). */
export const SHELL_OPEN_EVENT = 'mk:shell-open';

// The Favorites group's key. Saved section orders are keyed by section name;
// favorites live in prefs.fav, so this never reaches saved data. The NUL keeps
// it from ever equalling a real section name.
const FAV = '\u0000fav';
const strings = (a) => (Array.isArray(a) ? [...new Set(a.filter((k) => typeof k === 'string'))] : []);
const cleanOrder = (o) => {
  const out = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [g, list] of Object.entries(o)) { const s = strings(list); if (s.length) out[g] = s; }
  }
  return out;
};
const cleanNavPrefs = (v) => ({ fav: strings(v?.fav), order: cleanOrder(v?.order), hidden: strings(v?.hidden) });
const EMPTY = { fav: [], order: {}, hidden: [] };
const isEmpty = (p) => !p.fav.length && !p.hidden.length && !Object.keys(p.order).length;

/** `keys` in the saved order; unknown keys dropped, new ones slotted after the key they follow by default. */
export function orderKeys(keys, saved) {
  return orderColumns(keys.map((key) => ({ key })), saved).map((c) => c.key);
}

/** The words a page is searched and announced by: `text`, else a string label. */
const textOf = (it) => (it.text != null ? String(it.text) : typeof it.label === 'string' ? it.label : '');
const keywordsOf = (it) => (Array.isArray(it.keywords) ? it.keywords.join(' ') : it.keywords || '');
/** A page's key: its value. An action item with no value (Sign out) gets one from its text; it is shown but never starred, moved or hidden. */
const keyOf = (it) => (it.value != null ? String(it.value) : `\u0000${textOf(it)}`);
const isPage = (it) => it.value != null;

/**
 * NavList-style items (`{ section }` headings followed by `{ value, label, … }`)
 * split into groups: [{ key, section, count, items }]. Items before the first
 * heading form a group with section null and key ''. A repeated section name
 * gets "#2", "#3"…; a repeated value within a group is shown once.
 */
export function navGroups(items) {
  const groups = [];
  const seen = new Map();
  let cur = null;
  for (const it of items) {
    if (it.section != null) {
      const base = typeof it.section === 'string' ? it.section : String(it.text ?? 'Section');
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      cur = { key: n > 1 ? `${base}#${n}` : base, section: it.section, count: it.count, items: [] };
      groups.push(cur);
      continue;
    }
    if (!cur) { cur = { key: '', section: null, count: undefined, items: [] }; groups.push(cur); }
    if (!cur.items.some((x) => keyOf(x) === keyOf(it))) cur.items.push(it);
  }
  return groups;
}

/** The menu as shown: Favorites first, then each section in the saved order, hidden pages left out unless `editing`. */
export function arrangeNav(items, prefs, { editing = false } = {}) {
  const p = cleanNavPrefs(prefs);
  const pages = new Map();
  items.forEach((it) => { if (it.section == null && isPage(it) && !pages.has(keyOf(it))) pages.set(keyOf(it), it); });
  const keep = (k) => editing || !p.hidden.includes(k);
  const out = [];
  const favs = p.fav.filter((k) => pages.has(k) && keep(k));
  if (favs.length) out.push({ key: FAV, section: null, favorites: true, items: favs.map((k) => pages.get(k)) });
  for (const g of navGroups(items)) {
    const byKey = new Map(g.items.map((it) => [keyOf(it), it]));
    const ordered = orderKeys([...byKey.keys()], p.order[g.key]).filter(keep).map((k) => byKey.get(k));
    if (ordered.length) out.push({ ...g, items: ordered });
  }
  return out;
}

/** Pages matching `query` (by text or keywords), hidden ones included so nothing is ever lost. Text matches first. */
export function searchNav(items, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const seen = new Set();
  return items
    .filter((it) => {
      if (it.section != null || seen.has(keyOf(it))) return false;
      seen.add(keyOf(it));
      return matchesQuery(q, [textOf(it), keywordsOf(it)]);
    })
    .sort((a, b) => Number(!matchesQuery(q, [textOf(a)])) - Number(!matchesQuery(q, [textOf(b)])));
}

/**
 * A person's menu choices (favorites, order within each section, hidden pages),
 * saved under `prefKey` in this browser, and on the account when you pass
 * async load/save (as with useColumnOrder / useSavedFilters).
 *   const nav = useNavMenu('admin.menu', { load: getUiPref, save: saveUiPref });
 */
export function useNavMenu(prefKey, { load, save } = {}) {
  // Browser copy + account copy, shared with every other saved choice (useSavedPref).
  // An empty choice counts as none, so it is never sent up over another browser's.
  const [prefs, setSaved] = useSavedPref(prefKey, {
    load, save, fallback: EMPTY,
    clean: (v) => { const p = cleanNavPrefs(v); return isEmpty(p) ? null : p; },
  });
  const commit = (next) => setSaved(isEmpty(next) ? null : next);
  const flip = (list, k) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

  return {
    prefs,
    isFavorite: (v) => prefs.fav.includes(String(v)),
    isHidden: (v) => prefs.hidden.includes(String(v)),
    toggleFavorite: (v) => commit({ ...prefs, fav: flip(prefs.fav, String(v)) }),
    toggleHidden: (v) => commit({ ...prefs, hidden: flip(prefs.hidden, String(v)) }),
    /** Put `value` at index `to` of `keys` (the group's current order) and save. */
    moveTo: (group, keys, value, to) => {
      const k = String(value);
      const next = keys.map(String).filter((x) => x !== k);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, k);
      // Favorites not on screen right now (a page this login can't open, say)
      // keep their place at the end rather than being dropped.
      if (group === FAV) commit({ ...prefs, fav: [...next, ...prefs.fav.filter((x) => !next.includes(x))] });
      else commit({ ...prefs, order: { ...prefs.order, [group]: next } });
    },
    reset: () => commit(EMPTY),
  };
}

/** Runs searchExtra for the query after `delay` ms, dropping stale answers. */
function useExtraSearch(fn, query, min, delay) {
  const [state, setState] = useState({ q: '', sections: [], loading: false, error: false });
  const q = String(query || '').trim();
  useEffect(() => {
    if (!fn || q.length < min) { setState({ q: '', sections: [], loading: false, error: false }); return undefined; }
    setState((s) => ({ ...s, loading: true, error: false }));
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = setTimeout(() => {
      Promise.resolve()
        .then(() => fn(q, { signal: ctl?.signal }))
        .then((res) => {
          if (ctl?.signal.aborted) return;
          const sections = (Array.isArray(res) ? res : [])
            .filter((s) => s && Array.isArray(s.items) && s.items.length);
          setState({ q, sections, loading: false, error: false });
        })
        .catch(() => { if (!ctl?.signal.aborted) setState({ q, sections: [], loading: false, error: true }); });
    }, delay);
    return () => { clearTimeout(t); ctl?.abort(); };
  }, [fn, q, min, delay]);
  return state;
}

const typing = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

/**
 * Sidebar menu people can search, star favorites in, and rearrange. Takes the
 * same items as NavList (plus `keywords` for other names a page goes by, and
 * `text` when the label isn't a plain string) and remembers each person's
 * choices under `prefKey`. One per page: it owns the search shortcut.
 *   <SidebarLayout sidebar={
 *     <NavMenu prefKey="admin.menu" load={getUiPref} save={saveUiPref} value={tab} onChange={setTab} items={[
 *       { section: 'Sales', count: 6 },
 *       { value: 'leads', label: 'Leads', icon: <UsersIcon />, count: 5, keywords: 'prospects inquiries' },
 *     ]} />
 *   } />
 * ⌘K / Ctrl+K or "/" focuses the search (and opens the phone menu); Enter opens the first match.
 * shortcut="/" makes it ⌘/ / Ctrl+/ only (any key works); shortcut={false} turns it off.
 * editing + onEditingChange drive edit mode from outside; editButton={false} drops the
 * built-in "Edit menu" button (Done / Reset menu still show while editing); hint={false}
 * drops the "Tip: star a page" line.
 * searchExtra(query, { signal }) → Promise<[{ section, items: [{ key, label, detail, href, onClick, icon }], more? }]>
 * adds record results (cars, trips…) under the page matches, fetched searchDelay ms (200)
 * after typing stops once the query has searchMin (2) characters; `more` is a
 * { label, href, onClick } "See all" link. ↑ / ↓ move through results, Esc clears.
 */
export function NavMenu({
  items, value, onChange, prefKey, load, save, label = 'Menu',
  placeholder = 'Search menu', favoritesLabel = 'Favorites', shortcut = true, className = '',
  editing: editingProp, onEditingChange, editButton = true, hint = true,
  searchExtra, searchMin = 2, searchDelay = 200,
}) {
  const nav = useNavMenu(prefKey, { load, save });
  const [query, setQuery] = useState('');
  // Edit mode can be driven from outside (editing + onEditingChange), e.g. an
  // "Edit menu" link in the app's account footer with editButton={false}.
  const [editingOwn, setEditingOwn] = useState(false);
  const editing = editingProp ?? editingOwn;
  const setEditing = (on) => { if (editingProp === undefined) setEditingOwn(on); onEditingChange?.(on); };
  const [drag, setDrag] = useState(null); // { group, key, index }
  const [over, setOver] = useState(null); // { group, key, after }
  const inputRef = useRef(null);
  const navRef = useRef(null);

  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing) return;
      const key = String(e.key || '').toLowerCase();
      const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
      // true: ⌘K / Ctrl+K and a bare "/". A string: ⌘ or Ctrl plus that key only
      // (shortcut="/" → ⌘/), for an app whose own search already owns ⌘K and "/".
      const combo = typeof shortcut === 'string' ? mod && key === shortcut.toLowerCase() : mod && key === 'k';
      const slash = shortcut === true && key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(document.activeElement);
      if (!combo && !slash) return;
      e.preventDefault();
      window.dispatchEvent(new Event(SHELL_OPEN_EVENT));
      // The phone menu becomes visible (and focusable) on the next frame.
      setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 30);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut]);

  const groups = useMemo(() => arrangeNav(items, nav.prefs, { editing }), [items, nav.prefs, editing]);
  const hits = useMemo(() => searchNav(items, query), [items, query]);
  const searching = query.trim() !== '';
  const extra = useExtraSearch(searchExtra, query, searchMin, searchDelay);
  const extraCount = extra.sections.reduce((n, s) => n + s.items.length, 0);

  useEffect(() => { if (editing) setQuery(''); }, [editing]);

  const pick = (it, e) => {
    it.onClick?.(e);
    if (!it.onClick && onChange) onChange(it.value);
    if (searching) setQuery('');
  };

  const resultLinks = () => [...(navRef.current?.querySelectorAll('.mk-nav-item, .mk-nav-more') || [])];
  const onNavKey = (e) => {
    if (!searching) return;
    if (e.key === 'Escape') { e.preventDefault(); setQuery(''); inputRef.current?.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = resultLinks();
    const i = links.indexOf(document.activeElement);
    e.preventDefault();
    if (e.key === 'ArrowUp' && i <= 0) { inputRef.current?.focus(); return; }
    links[Math.min(links.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))]?.focus();
  };

  const extraRow = (sec, it, i) => {
    const Tag = it.href ? 'a' : 'button';
    return (
      <div key={`x:${sec}:${it.key ?? i}`} className="mk-nav-row">
        <Tag
          type={Tag === 'button' ? 'button' : undefined}
          href={it.href}
          className="mk-nav-item mk-nav-result"
          onClick={(e) => { it.onClick?.(e); setQuery(''); }}
        >
          {it.icon}
          <span className="mk-nav-label">
            {typeof it.label === 'string' ? highlight(it.label, query) : it.label}
            {it.detail && <span className="mk-nav-detail">{typeof it.detail === 'string' ? highlight(it.detail, query) : it.detail}</span>}
          </span>
        </Tag>
      </div>
    );
  };

  // After ↑ / ↓ the row re-renders elsewhere: keep focus on its arrow, or on
  // the other one when it just reached the end and its own is now disabled.
  const move = (group, keys, k, i, dir) => {
    nav.moveTo(group, keys, k, i + dir);
    requestAnimationFrame(() => {
      const root = navRef.current;
      if (!root) return;
      const grp = [...root.querySelectorAll('[data-nav-group]')].find((el) => el.dataset.navGroup === group);
      const sel = (d) => [...(grp?.querySelectorAll('[data-nav-move]') || [])].find((b) => b.dataset.navMove === `${k}|${d}`);
      const btn = sel(dir);
      (btn && !btn.disabled ? btn : sel(-dir))?.focus();
    });
  };

  const row = (it, group, i, keys) => {
    const k = keyOf(it);
    const page = isPage(it);
    const fav = page && nav.isFavorite(k);
    const hidden = page && nav.isHidden(k);
    const canEdit = editing && group != null && page;
    const text = textOf(it) || k;
    const via = searching && !matchesQuery(query, [textOf(it)]) && keywordsOf(it)
      ? keywordsOf(it).split(/\s+/).find((w) => matchesQuery(query, [w])) : null;
    // In edit mode the page is a plain label, so the whole row drags (Firefox
    // won't start a drag on a button, and a link would drag its URL).
    const Tag = canEdit ? 'span' : it.href ? 'a' : 'button';
    const isOver = over && over.group === group && over.key === k;
    const content = (
      <>
        {it.icon}
        <span className="mk-nav-label">
          {searching && typeof it.label === 'string' ? highlight(it.label, query) : it.label}
          {via && <span className="mk-nav-via"> · {highlight(via, query)}</span>}
        </span>
        <NavCount it={it} />
      </>
    );
    return (
      <div
        key={k}
        className={cx(
          'mk-nav-row', hidden && 'mk-nav-row-hidden', canEdit && 'mk-nav-row-editable',
          drag && drag.group === group && drag.key === k && 'mk-nav-row-dragging',
          isOver && (over.after ? 'mk-nav-row-over-after' : 'mk-nav-row-over'),
        )}
        draggable={canEdit || undefined}
        onDragStart={canEdit ? (e) => {
          setDrag({ group, key: k, index: i });
          try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', text); } catch { /* no dataTransfer */ }
        } : undefined}
        onDragOver={canEdit && drag?.group === group ? (e) => {
          e.preventDefault();
          if (drag.key !== k) setOver({ group, key: k, after: i > drag.index });
        } : undefined}
        onDragLeave={canEdit ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); } : undefined}
        onDrop={canEdit && drag?.group === group ? (e) => {
          e.preventDefault();
          if (drag.key !== k) nav.moveTo(group, keys, drag.key, i);
          setDrag(null); setOver(null);
        } : undefined}
        onDragEnd={canEdit ? () => { setDrag(null); setOver(null); } : undefined}
      >
        {canEdit && <GripIcon className="mk-nav-grip" />}
        <Tag
          type={Tag === 'button' ? 'button' : undefined}
          href={Tag === 'a' ? it.href : undefined}
          className="mk-nav-item"
          aria-current={!canEdit && group !== FAV && it.value === value ? 'page' : undefined}
          onClick={canEdit ? undefined : (e) => pick(it, e)}
        >
          {content}
        </Tag>
        {canEdit && (
          <span className="mk-nav-tools">
            <Button variant="ghost" size="sm" className="mk-nav-tool" icon={ArrowUpIcon} label={`Move ${text} up`} data-nav-move={`${k}|-1`} disabled={i === 0} onClick={() => move(group, keys, k, i, -1)} />
            <Button variant="ghost" size="sm" className="mk-nav-tool" icon={ArrowDownIcon} label={`Move ${text} down`} data-nav-move={`${k}|1`} disabled={i === keys.length - 1} onClick={() => move(group, keys, k, i, 1)} />
            {group !== FAV && (
              <Button variant="ghost" size="sm" className="mk-nav-tool" icon={hidden ? EyeOffIcon : EyeIcon} aria-pressed={hidden} label={`Hide ${text}`} onClick={() => nav.toggleHidden(k)} />
            )}
          </span>
        )}
        {page && !editing && (
          <Button variant="ghost" size="sm" className="mk-nav-star" icon={StarIcon} aria-pressed={fav} label={`Favorite ${text}`} onClick={() => nav.toggleFavorite(k)} />
        )}
      </div>
    );
  };

  return (
    <div className={cx('mk-navmenu', editing && 'mk-navmenu-editing', className)}>
      <SearchInput
        ref={inputRef}
        className="mk-navmenu-search"
        value={query}
        onChange={setQuery}
        placeholder={placeholder}
        aria-label={placeholder}
        onKeyDown={(e) => {
          // A real click on the first result: follows a link, runs onClick or
          // onChange, and lets SidebarLayout close the phone menu.
          if (e.key === 'Enter' && (hits[0] || extraCount)) { e.preventDefault(); navRef.current?.querySelector('.mk-nav-item')?.click(); }
          else if (e.key === 'ArrowDown' && searching) { e.preventDefault(); resultLinks()[0]?.focus(); }
          else if (e.key === 'Escape' && searching) { e.preventDefault(); setQuery(''); }
        }}
      />
      <p className="mk-sr-only" role="status">
        {searching ? [hits.length === 1 ? '1 page' : `${hits.length} pages`, extraCount ? `${extraCount} more results` : ''].filter(Boolean).join(', ') : ''}
      </p>
      <nav ref={navRef} className="mk-nav" aria-label={label} onKeyDown={onNavKey}>
        {searching ? (
          <>
            {hits.length ? hits.map((it) => row(it, null, 0, []))
              : !extraCount && !extra.loading ? <p className="mk-nav-empty">{searchExtra ? 'Nothing matches' : 'No page matches'} “{query.trim()}”.</p> : null}
            {extra.sections.map((sec, si) => (
              <div key={`xs:${si}`} className="mk-nav-group" role="group" aria-label={typeof sec.section === 'string' ? sec.section : undefined}>
                <div className="mk-nav-section"><span>{sec.section}</span></div>
                {sec.items.map((it, i) => extraRow(si, it, i))}
                {sec.more && (sec.more.href
                  ? <a className="mk-nav-more" href={sec.more.href} onClick={(e) => { sec.more.onClick?.(e); setQuery(''); }}>{sec.more.label || 'See all'}</a>
                  : <button type="button" className="mk-nav-more" onClick={(e) => { sec.more.onClick?.(e); setQuery(''); }}>{sec.more.label || 'See all'}</button>)}
              </div>
            ))}
            {extra.loading && <p className="mk-nav-empty">Searching…</p>}
            {extra.error && <p className="mk-nav-empty">Couldn't search records. Try again.</p>}
          </>
        ) : groups.map((g) => {
          const keys = g.items.filter(isPage).map(keyOf);
          return (
            <div key={`g:${g.key}`} data-nav-group={g.key} className="mk-nav-group" role="group" aria-label={g.favorites ? favoritesLabel : (typeof g.section === 'string' ? g.section : undefined)}>
              {(g.favorites || g.section != null) && (
                <div className="mk-nav-section">
                  <span>{g.favorites ? favoritesLabel : g.section}</span>
                  {g.count != null && g.count !== '' && <span className="mk-tabular">{g.count}</span>}
                </div>
              )}
              {g.items.map((it) => row(it, g.key, keys.indexOf(keyOf(it)), keys))}
            </div>
          );
        })}
        {hint && !searching && !editing && !nav.prefs.fav.length && (
          <p className="mk-nav-hint">Tip: star a page to pin it to the top.</p>
        )}
      </nav>
      {(editing || editButton) && <div className="mk-navmenu-edit">
        {editing ? (
          <>
            <Button size="sm" onClick={() => setEditing(false)}>Done</Button>
            <Button variant="ghost" size="sm" onClick={nav.reset}>Reset menu</Button>
            <p className="mk-nav-hint">Drag, or use the arrows, to move a page within its group. The eye hides a page; search still finds it.</p>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit menu</Button>
        )}
      </div>}
    </div>
  );
}
