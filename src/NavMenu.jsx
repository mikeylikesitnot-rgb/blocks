import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from './cx.js';
import { Button } from './Button.jsx';
import { SearchInput } from './Inputs.jsx';
import { matchesQuery } from './search.js';
import { highlight } from './highlight.jsx';
import { readPref, writePref } from './prefs.js';
import { orderColumns } from './ColumnOrder.jsx';
import { ArrowUpIcon, ArrowDownIcon, GripIcon, StarIcon, EyeIcon, EyeOffIcon } from './icons.jsx';

/** Tells SidebarLayout to open its phone menu (NavMenu sends it for ⌘K and "/"). */
export const SHELL_OPEN_EVENT = 'mk:shell-open';

const FAV = '__fav';
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

/**
 * NavList-style items (`{ section }` headings followed by `{ value, label, … }`)
 * split into groups: [{ key, section, count, items }]. Items before the first
 * heading form a group with section null and key ''.
 */
export function navGroups(items) {
  const groups = [];
  let cur = null;
  for (const it of items) {
    if (it.section != null) { cur = { key: String(it.section), section: it.section, count: it.count, items: [] }; groups.push(cur); continue; }
    if (!cur) { cur = { key: '', section: null, count: undefined, items: [] }; groups.push(cur); }
    cur.items.push(it);
  }
  return groups;
}

/** The menu as shown: Favorites first, then each section in the saved order, hidden pages left out unless `editing`. */
export function arrangeNav(items, prefs, { editing = false } = {}) {
  const p = cleanNavPrefs(prefs);
  const byValue = new Map(items.filter((it) => it.section == null && it.value != null).map((it) => [String(it.value), it]));
  const keep = (k) => editing || !p.hidden.includes(k);
  const out = [];
  const favs = p.fav.filter((k) => byValue.has(k) && keep(k));
  if (favs.length) out.push({ key: FAV, section: null, favorites: true, items: favs.map((k) => byValue.get(k)) });
  for (const g of navGroups(items)) {
    const vals = g.items.map((it) => String(it.value));
    const ordered = orderKeys(vals, p.order[g.key]).filter(keep).map((k) => byValue.get(k));
    if (ordered.length) out.push({ ...g, items: ordered });
  }
  return out;
}

const keywordsOf = (it) => (Array.isArray(it.keywords) ? it.keywords.join(' ') : it.keywords || '');

/** Pages matching `query` (by label or keywords), hidden ones included so nothing is ever lost. */
export function searchNav(items, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  return items.filter((it) => it.section == null && matchesQuery(q, [it.label, keywordsOf(it)]))
    .sort((a, b) => Number(!matchesQuery(q, [a.label])) - Number(!matchesQuery(q, [b.label])));
}

/**
 * A person's menu choices (favorites, order within each section, hidden pages),
 * saved under `prefKey` in this browser, and on the account when you pass
 * async load/save (as with useColumnOrder / useSavedFilters).
 *   const nav = useNavMenu('admin.menu', { load: getUiPref, save: saveUiPref });
 */
export function useNavMenu(prefKey, { load, save } = {}) {
  const [prefs, setPrefs] = useState(() => cleanNavPrefs(readPref(prefKey)));
  const touched = useRef(false);
  const io = useRef({ load, save });
  io.current = { load, save };

  useEffect(() => {
    touched.current = false;
    setPrefs(cleanNavPrefs(readPref(prefKey)));
    const { load: loadFn } = io.current;
    if (!loadFn) return undefined;
    let live = true;
    Promise.resolve().then(() => loadFn(prefKey)).then((saved) => {
      if (!live || touched.current || !saved || typeof saved !== 'object') return;
      const next = cleanNavPrefs(saved);
      setPrefs(next);
      writePref(prefKey, next);
    }).catch(() => { /* the local copy stands */ });
    return () => { live = false; };
  }, [prefKey]);

  const commit = (next) => {
    touched.current = true;
    setPrefs(next);
    const value = isEmpty(next) ? null : next;
    writePref(prefKey, value);
    const { save: saveFn } = io.current;
    if (saveFn) Promise.resolve().then(() => saveFn(prefKey, value)).catch(() => {});
  };
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
      if (group === FAV) commit({ ...prefs, fav: next });
      else commit({ ...prefs, order: { ...prefs.order, [group]: next } });
    },
    reset: () => commit(EMPTY),
  };
}

const typing = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

/**
 * Sidebar menu people can search, star favorites in, and rearrange. Takes the
 * same items as NavList (plus `keywords` for other names a page goes by) and
 * remembers each person's choices under `prefKey`.
 *   <SidebarLayout sidebar={
 *     <NavMenu prefKey="admin.menu" load={getUiPref} save={saveUiPref} value={tab} onChange={setTab} items={[
 *       { section: 'Sales', count: 6 },
 *       { value: 'leads', label: 'Leads', icon: <UsersIcon />, count: 5, keywords: 'prospects inquiries' },
 *     ]} />
 *   } />
 * ⌘K / Ctrl+K or "/" focuses the search (and opens the phone menu); Enter opens the first match.
 */
export function NavMenu({
  items, value, onChange, prefKey, load, save, label = 'Menu',
  placeholder = 'Search menu', favoritesLabel = 'Favorites', shortcut = true, className = '',
}) {
  const nav = useNavMenu(prefKey, { load, save });
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState(null); // { group, key }
  const [over, setOver] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (e) => {
      const cmdK = (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(document.activeElement);
      if (!cmdK && !slash) return;
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

  const pick = (it, e) => {
    it.onClick?.(e);
    if (!it.onClick && onChange) onChange(it.value);
    if (searching) setQuery('');
  };

  const row = (it, group, i, keys) => {
    const k = String(it.value);
    const fav = nav.isFavorite(k);
    const hidden = nav.isHidden(k);
    const canEdit = editing && group != null;
    const Tag = it.href ? 'a' : 'button';
    const name = typeof it.label === 'string' ? it.label : k;
    const via = searching && !matchesQuery(query, [it.label]) && keywordsOf(it)
      ? keywordsOf(it).split(/\s+/).find((w) => matchesQuery(query, [w])) : null;
    return (
      <div
        key={`${group ?? 'q'}-${k}`}
        className={cx('mk-nav-row', hidden && 'mk-nav-row-hidden', drag?.key === k && drag?.group === group && 'mk-nav-row-dragging', over === `${group}-${k}` && 'mk-nav-row-over')}
        draggable={canEdit || undefined}
        onDragStart={canEdit ? (e) => { setDrag({ group, key: k }); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', k); } catch { /* old browsers */ } } : undefined}
        onDragOver={canEdit && drag?.group === group ? (e) => { e.preventDefault(); setOver(`${group}-${k}`); } : undefined}
        onDrop={canEdit && drag?.group === group ? (e) => { e.preventDefault(); nav.moveTo(group, keys, drag.key, keys.indexOf(k)); setDrag(null); setOver(null); } : undefined}
        onDragEnd={canEdit ? () => { setDrag(null); setOver(null); } : undefined}
      >
        {canEdit && <GripIcon className="mk-nav-grip" />}
        <Tag
          type={it.href ? undefined : 'button'}
          href={it.href}
          className="mk-nav-item"
          aria-current={it.value === value ? 'page' : undefined}
          onClick={(e) => pick(it, e)}
        >
          {it.icon}
          <span className="mk-nav-label">
            {searching ? highlight(name, query) : it.label}
            {via && <span className="mk-nav-via"> · {highlight(via, query)}</span>}
          </span>
          {it.count != null && it.count !== '' && (
            <span className={cx('mk-nav-count mk-tabular', it.hot && 'mk-nav-count-hot')}>{it.count}</span>
          )}
        </Tag>
        {canEdit && (
          <span className="mk-nav-tools">
            <Button variant="ghost" size="sm" className="mk-nav-tool" icon={ArrowUpIcon} label={`Move ${name} up`} disabled={i === 0} onClick={() => nav.moveTo(group, keys, k, i - 1)} />
            <Button variant="ghost" size="sm" className="mk-nav-tool" icon={ArrowDownIcon} label={`Move ${name} down`} disabled={i === keys.length - 1} onClick={() => nav.moveTo(group, keys, k, i + 1)} />
            {group !== FAV && (
              <Button variant="ghost" size="sm" className="mk-nav-tool" icon={hidden ? EyeOffIcon : EyeIcon} aria-pressed={hidden} label={hidden ? `Show ${name}` : `Hide ${name}`} onClick={() => nav.toggleHidden(k)} />
            )}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="mk-nav-star"
          icon={StarIcon}
          aria-pressed={fav}
          label={fav ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
          onClick={() => nav.toggleFavorite(k)}
        />
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
        onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { e.preventDefault(); pick(hits[0], e); } }}
      />
      <nav className="mk-nav" aria-label={label}>
        {searching ? (
          hits.length ? hits.map((it) => row(it, null, 0, [])) : <p className="mk-nav-empty">No page matches “{query.trim()}”.</p>
        ) : groups.map((g) => {
          const keys = g.items.map((it) => String(it.value));
          return (
            <div key={g.key || '_'} className="mk-nav-group" role="group" aria-label={g.favorites ? favoritesLabel : (typeof g.section === 'string' ? g.section : undefined)}>
              {(g.favorites || g.section != null) && (
                <div className="mk-nav-section">
                  <span>{g.favorites ? favoritesLabel : g.section}</span>
                  {g.count != null && g.count !== '' && <span className="mk-tabular">{g.count}</span>}
                </div>
              )}
              {g.items.map((it, i) => row(it, g.key, i, keys))}
            </div>
          );
        })}
        {!searching && !editing && !nav.prefs.fav.length && (
          <p className="mk-nav-hint">Tip: star a page to pin it to the top.</p>
        )}
      </nav>
      <div className="mk-navmenu-edit">
        {editing ? (
          <>
            <Button size="sm" onClick={() => setEditing(false)}>Done</Button>
            <Button variant="ghost" size="sm" onClick={nav.reset}>Reset menu</Button>
            <p className="mk-nav-hint">Drag, or use the arrows, to move a page within its group. The eye hides a page; search still finds it.</p>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setEditing(true); }}>Edit menu</Button>
        )}
      </div>
    </div>
  );
}
