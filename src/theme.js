import { useCallback, useEffect, useState } from 'react';

const KEY = 'mk-theme';

/**
 * Light / dark / system. Writes <html data-theme> and remembers the choice.
 *   const [theme, setTheme] = useTheme();   // 'system' | 'light' | 'dark'
 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  const setTheme = useCallback((t) => {
    setThemeState(t);
    try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private mode */ }
  }, []);
  return [theme, setTheme];
}
