import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { THEME_STORAGE_KEY as STORAGE_KEY, LEGACY_THEME_STORAGE_KEY as LEGACY_STORAGE_KEY, COLOR_THEME_STORAGE_KEY as COLOR_STORAGE_KEY } from '../brand.js';

export type Theme = 'light' | 'dark';
export type ColorTheme = 'sunset' | 'aurora';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  colorTheme: ColorTheme;
  setColorTheme: (theme: ColorTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark', setTheme: () => {}, colorTheme: 'sunset', setColorTheme: () => {},
});

// Keep these defaults in sync with the pre-paint script in index.html.
function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* Storage can be unavailable in embedded browsers. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveInitialColorTheme(): ColorTheme {
  try { return localStorage.getItem(COLOR_STORAGE_KEY) === 'aurora' ? 'aurora' : 'sunset'; }
  catch { return 'sunset'; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(resolveInitialColorTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('no-transitions');
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.colorTheme = colorTheme;
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) favicon.href = colorTheme === 'aurora' ? '/favicon-aurora.svg' : '/favicon.svg';
    const frame = requestAnimationFrame(() => root.classList.remove('no-transitions'));
    return () => { cancelAnimationFrame(frame); root.classList.remove('no-transitions'); };
  }, [theme, colorTheme]);

  const setTheme = useCallback((next: Theme) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep in-memory selection working. */ }
    setThemeState(next);
  }, []);

  const setColorTheme = useCallback((next: ColorTheme) => {
    try { localStorage.setItem(COLOR_STORAGE_KEY, next); } catch { /* Keep in-memory selection working. */ }
    setColorThemeState(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme, colorTheme, setColorTheme }}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
