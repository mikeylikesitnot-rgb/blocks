/*
 * Plain helpers for list filters kept in the URL (see useSavedFilters and
 * RangeFilter). Ported from AutoDealer (docs/decisions/list-filters.md).
 *
 * `params` below is a URLSearchParams, a query string, or a plain object such
 * as useSavedFilters' `filters`.
 */

const getter = (params) => {
  if (params == null) return () => null;
  if (typeof params === 'string') { const p = new URLSearchParams(params); return (k) => p.get(k); }
  if (typeof params.get === 'function') return (k) => params.get(k);
  return (k) => params[k] ?? null;
};

/** A positive whole number from a URL param, or null for anything else. */
const posInt = (v) => (v != null && /^[1-9][0-9]*$/.test(String(v)) ? Number(v) : null);

/** A checklist's values from one comma-separated param (?make=Honda,Toyota). Empty pieces dropped. */
export const listParam = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * A number range kept as two params (?minPrice=5000&maxPrice=12000), whole
 * numbers, either end open (absent). Returns [min, max] with null for an open end.
 * `legacyKey` reads old fixed-band links (?price=0-5000,5000-10000) as the span
 * they covered when neither param is set; a band max of 0 or 999999 means no upper limit.
 *   const price = rangeParam(filters, 'minPrice', 'maxPrice');
 */
export function rangeParam(params, minKey, maxKey, legacyKey = null) {
  const get = getter(params);
  const min = posInt(get(minKey));
  const max = posInt(get(maxKey));
  if (min || max || !legacyKey) return [min, max];
  const bands = listParam(get(legacyKey))
    .map((b) => /^(\d+)-(\d+)$/.exec(b))
    .filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2])]);
  if (!bands.length) return [null, null];
  const lo = Math.min(...bands.map(([a]) => a));
  const open = bands.some(([, b]) => b === 0 || b >= 999999);
  const hi = open ? 0 : Math.max(...bands.map(([, b]) => b));
  return [lo > 0 ? lo : null, hi > 0 ? hi : null];
}

/** Whether n is inside [min, max], both ends included, null = open. A missing n is outside any set range. */
export function inRange(n, [min, max] = [null, null]) {
  if (min == null && max == null) return true;
  const x = typeof n === 'number' ? n : Number(n);
  if (n == null || n === '' || !Number.isFinite(x)) return false;
  return (min == null || x >= min) && (max == null || x <= max);
}

/**
 * The slider's ends: 0 up to the largest value (and anything already picked,
 * so a link asking for more than the data holds still shows its number),
 * rounded up to a whole step. Never a zero-width track.
 *   rangeBounds(cars.map((c) => c.price), 500) // [0, 45500]
 */
export function rangeBounds(values, step = 1, picked = []) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  const top = Math.max(step, ...nums, ...picked.filter((n) => n != null).map(Number));
  return [0, Math.ceil(top / step) * step];
}

/** "$12,500": the exact figure, for the number boxes and screen readers. */
export const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

/** "$12.5k": the short figure for the closed button. */
export function shortMoney(n) {
  if (n < 1000) return `$${Math.round(n)}`;
  const k = Math.round(n / 100) / 10;
  return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

/** What the closed RangeFilter button says: "Any price", "$5k–$12k", "$5k+", "Up to $12k". */
export function rangeSummary([min, max], { allLabel = 'Any', upTo = 'Up to', format = shortMoney } = {}) {
  if (min == null && max == null) return allLabel;
  if (min != null && max != null) return `${format(min)}–${format(max)}`;
  return min != null ? `${format(min)}+` : `${upTo} ${format(max)}`;
}
