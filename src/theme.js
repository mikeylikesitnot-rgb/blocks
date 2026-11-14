import { useCallback, useEffect, useState } from 'react';

const KEY = 'mk-theme';
const EVT = 'mk:theme';
const read = () => { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } };

/**
 * Light / dark / system. Writes <html data-theme> and remembers the choice.
 * Every component using it stays in step (e.g. a header toggle and a
 * sidebar ThemeSwitch).
 *   const [theme, setTheme] = useTheme();   // 'system' | 'light' | 'dark'
 */
export function useTheme() {
  const [theme, setThemeState] = useState(read);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => {
    const sync = (e) => setThemeState(e.detail ?? read());
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);
  const setTheme = useCallback((t) => {
    setThemeState(t);
    try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent(EVT, { detail: t }));
  }, []);
  return [theme, setTheme];
}
