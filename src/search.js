import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Every typed word must match somewhere in `fields`. Words match by prefix
 * of any word; digit-only terms match digits anywhere, so "2415" finds
 * plate SPT2415 and phone (214) 555-2415.
 *   rows.filter((r) => matchesQuery(q, [r.name, r.phone, r.vin]))
 */
export function matchesQuery(query, fields) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = fields.filter((f) => f != null && f !== '').map((f) => String(f).toLowerCase());
  if (!hay.length) return false;
  const joined = hay.join(' ');
  const words = joined.split(/[^a-z0-9#]+/).filter(Boolean);
  const digits = hay.map((h) => h.replace(/\D/g, '')).join(' ');
  return q.split(/\s+/).every((term) => {
    const t = term.replace(/^#/, '');
    if (!t) return true;
    if (/^\d+$/.test(t)) return digits.includes(t) || joined.includes(t);
    return words.some((w) => w.startsWith(t)) || joined.includes(t);
  });
}

const EVT = 'mk:urlstate';

/** Tell every URL-backed hook on the page to re-read the query. */
export const URL_EVENT = EVT;

/**
 * Patch some query params and leave the rest alone (null or '' removes one).
 * Replaces rather than pushes, so filtering doesn't fill up Back.
 */
export function patchUrl(changes) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(changes)) {
    if (v == null || v === '') url.searchParams.delete(k);
    else url.searchParams.set(k, String(v));
  }
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event(EVT));
}

/**
 * A string kept in the URL query (?key=value) so searches and tabs survive a
 * reload and can be shared. Uses history.replaceState, so it works with or
 * without a router.
 *   const [q, setQ] = useUrlState('q');
 */
export function useUrlState(key, fallback = '') {
  const read = () => new URLSearchParams(window.location.search).get(key) ?? fallback;
  const [value, setValue] = useState(read);

  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener('popstate', sync);
    window.addEventListener(EVT, sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener(EVT, sync); };
  }, [key, fallback]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((v) => {
    patchUrl({ [key]: v === fallback ? null : v });
  }, [key, fallback]);

  return [value, set];
}

/**
 * A list kept in the URL as one comma-separated param (?status=live,planned),
 * for FilterMenu. Empty list = param removed. Values must not contain commas.
 *   const [status, setStatus] = useUrlList('status');
 */
export function useUrlList(key) {
  const [raw, setRaw] = useUrlState(key);
  const list = useMemo(() => (raw ? raw.split(',').filter(Boolean) : []), [raw]);
  const set = useCallback((arr) => setRaw((arr || []).join(',')), [setRaw]);
  return [list, set];
}
