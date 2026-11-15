import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { patchUrl, URL_EVENT } from './search.js';
import { readPref, writePref } from './prefs.js';

/*
 * A list's filter set, remembered. The filters LIVE in the URL (so reload,
 * Back and a pasted link work); this hook only decides what the URL starts
 * with, most specific first:
 *
 *   1. The URL names any of `keys` or `linkKeys` → shown as is, and opening
 *      it saves nothing (a shared link must not replace your own view).
 *   2. This browser session's filters for `prefKey` (sessionStorage, written
 *      by setFilters): put back when the list mounts again, e.g. after a tab
 *      switch, even if the account's set has since changed elsewhere.
 *   3. The saved set: localStorage by default. Pass async `load(prefKey)` /
 *      `save(prefKey, values|null)` to keep it on the signed-in account; the
 *      localStorage copy still applies at once, before `load` returns.
 *
 * Every setFilters saves the whole set; resetFilters clears the URL and the
 * saved copy. Keep free-text search and the page number out of `keys`: a
 * one-off lookup found still typed in next week would hide rows. Put them in
 * `linkKeys` if arriving with one should count as a link.
 *
 *   const { filters, setFilters, resetFilters } = useSavedFilters('orders.filters',
 *     ['status', 'minTotal', 'maxTotal'], { load: getPref, save: savePref, linkKeys: ['q'] });
 *   const status = listParam(filters.status);
 *   setFilters({ status: next.join(',') || null });
 *
 * Works without a router: it reads window.location and writes with
 * history.replaceState, like useUrlState.
 */
const sessionKey = (prefKey) => `mk.parked.${prefKey}`;

function readKeys(keys) {
  const p = new URLSearchParams(window.location.search);
  const out = {};
  for (const k of keys) out[k] = p.get(k) ?? '';
  return out;
}

/** Only the keys this list owns, and only non-empty strings, whatever was stored. */
function clean(saved, keys) {
  const out = {};
  for (const k of keys) if (typeof saved?.[k] === 'string' && saved[k]) out[k] = saved[k];
  return out;
}

const isEmpty = (o) => !o || Object.keys(o).length === 0;
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * What this list starts with, without touching anything (so it can run during
 * render, twice under StrictMode, and give the same answer).
 * { kind: 'link' | 'session' | 'saved', apply: params to write, filters }.
 */
function decide(prefKey, keys, linkKeys) {
  const p = new URLSearchParams(window.location.search);
  const fromUrl = readKeys(keys);
  if ([...keys, ...linkKeys].some((k) => k && p.get(k))) return { kind: 'link', apply: null, filters: fromUrl };
  const parked = clean(readPref(sessionKey(prefKey), { session: true }), keys);
  const kind = isEmpty(parked) ? 'saved' : 'session';
  const apply = kind === 'session' ? parked : clean(readPref(prefKey), keys);
  return { kind, apply: isEmpty(apply) ? null : apply, filters: { ...fromUrl, ...apply } };
}

export function useSavedFilters(prefKey, keys, { load, save, linkKeys = [] } = {}) {
  const keyList = keys.join(',');
  const linkList = linkKeys.join(',');
  // The first render already has the starting set, so an app that fetches on
  // filter change never makes an unfiltered request first.
  const [boot] = useState(() => ({ prefKey, ...decide(prefKey, keys, linkKeys) }));
  const [filters, setState] = useState(boot.filters);
  // How this mount began, decided once per prefKey. A ref survives
  // StrictMode's effect re-run, so a saved set just written to the URL isn't
  // then mistaken for an arriving link.
  const arrival = useRef(null);
  // Set once the person changes a filter, so a slow `load` can't undo it.
  const touched = useRef(false);
  const io = useRef({ load, save });
  io.current = { load, save };

  // Before paint: put the starting set in the URL (a link is left as it is).
  useIsoLayoutEffect(() => {
    const ks = keyList.split(',');
    if (arrival.current?.prefKey !== prefKey) {
      touched.current = false;
      const d = boot.prefKey === prefKey && !arrival.current ? boot : decide(prefKey, ks, linkList.split(','));
      if (d.apply) patchUrl(d.apply);
      arrival.current = { prefKey, kind: d.kind };
    }
  }, [prefKey, keyList, linkList]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ks = keyList.split(',');
    const sync = () => setState(readKeys(ks));
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener(URL_EVENT, sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener(URL_EVENT, sync); };
  }, [keyList]);

  // The account's saved set, when the app keeps one, replaces the local copy.
  // Nothing is parked on the way out: setFilters already wrote this session's
  // copy, and an incoming link the person never changed must not become it.
  useEffect(() => {
    const ks = keyList.split(',');
    const { load: loadFn } = io.current;
    if (arrival.current?.kind !== 'saved' || !loadFn) return undefined;
    let live = true;
    Promise.resolve().then(() => loadFn(prefKey)).then((saved) => {
      if (!live || touched.current) return;
      const value = clean(saved, ks);
      writePref(prefKey, isEmpty(value) ? null : value);
      // Also clear what the local copy applied but the account no longer has.
      const changes = {};
      for (const k of ks) changes[k] = value[k] ?? null;
      patchUrl(changes);
    }).catch(() => { /* the local copy stands */ });
    return () => { live = false; };
  }, [prefKey, keyList]);

  const store = useCallback((value) => {
    const v = isEmpty(value) ? null : value;
    writePref(prefKey, v);
    writePref(sessionKey(prefKey), v, { session: true });
    const { save: saveFn } = io.current;
    if (saveFn) Promise.resolve().then(() => saveFn(prefKey, v)).catch(() => { /* best effort */ });
  }, [prefKey]);

  /** Change some params (any; only `keys` are saved), then save the whole set. */
  const setFilters = useCallback((changes) => {
    touched.current = true;
    patchUrl(changes);
    store(clean(readKeys(keyList.split(',')), keyList.split(',')));
  }, [keyList, store]);

  /** Clear every key (plus any `extra` params, e.g. { q: null }) and the saved copy. */
  const resetFilters = useCallback((extra) => {
    touched.current = true;
    // Safe as a bare onClick handler: an event is not a set of params.
    const changes = extra && typeof extra === 'object' && !('nativeEvent' in extra) ? { ...extra } : {};
    for (const k of keyList.split(',')) changes[k] = null;
    patchUrl(changes);
    store({});
  }, [keyList, store]);

  return useMemo(() => ({ filters, setFilters, resetFilters }), [filters, setFilters, resetFilters]);
}
