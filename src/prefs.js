/*
 * Best-effort browser storage for saved UI choices (filters, columns).
 * Storage can be missing or throw (private windows, blocked site data) or
 * hold garbage; every read falls back to null and every write is silent.
 */

const store = (kind) => {
  try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch { return null; }
};

/** A stored plain object (or array when `array`), or null. */
export function readPref(key, { session = false, array = false } = {}) {
  try {
    const v = JSON.parse(store(session ? 'session' : 'local')?.getItem(key) || 'null');
    if (array) return Array.isArray(v) ? v : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/** Store `value` as JSON, or remove the key when value is null. */
export function writePref(key, value, { session = false } = {}) {
  try {
    const s = store(session ? 'session' : 'local');
    if (!s) return;
    if (value == null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable: the choice just isn't remembered */ }
}
