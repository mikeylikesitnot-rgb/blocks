import { useEffect, useRef, useState } from 'react';
import { readPref, writePref } from './prefs.js';

/**
 * One saved UI choice (an object), kept in this browser and, when `load` and
 * `save` are given, on the person's account so it follows them to any browser.
 *   const [prefs, setPrefs] = useSavedPref('admin.sidebar.7', { load: getUiPref, save: saveUiPref, fallback: { pinned: true } });
 * - Starts from this browser's copy (no jump while the account loads), else `fallback`.
 * - The account's value wins once it arrives, unless the person changed it first.
 * - The account has none yet: this browser's copy is sent up, once.
 * - set(value) stores it in both places; set(null) clears both (back to `fallback`).
 * `clean` (optional) tidies a stored value; return null to treat it as missing.
 */
export function useSavedPref(key, { load, save, fallback = null, clean = (v) => v } = {}) {
  const read = () => {
    const v = readPref(key);
    return v == null ? null : clean(v);
  };
  const [value, setValue] = useState(() => read() ?? fallback);
  const touched = useRef(false);
  const io = useRef({ load, save, clean, fallback });
  io.current = { load, save, clean, fallback };

  useEffect(() => {
    touched.current = false;
    const { load: loadFn, save: saveFn, clean: cleanFn, fallback: fb } = io.current;
    const local = (() => { const v = readPref(key); return v == null ? null : cleanFn(v); })();
    setValue(local ?? fb);
    if (!loadFn) return undefined;
    let live = true;
    Promise.resolve().then(() => loadFn(key)).then((saved) => {
      if (!live || touched.current) return;
      const next = saved && typeof saved === 'object' && !Array.isArray(saved) ? cleanFn(saved) : null;
      if (next == null) {
        if (saveFn && local != null) Promise.resolve().then(() => saveFn(key, local)).catch(() => {});
        return;
      }
      setValue(next);
      writePref(key, next);
    }).catch(() => { /* the browser's copy stands */ });
    return () => { live = false; };
  }, [key]);

  const set = (next) => {
    touched.current = true;
    setValue(next ?? io.current.fallback);
    writePref(key, next);
    const { save: saveFn } = io.current;
    if (saveFn) Promise.resolve().then(() => saveFn(key, next)).catch(() => {});
  };
  return [value, set];
}
