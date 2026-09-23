import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { THEME_STORAGE_KEY as STORAGE_KEY, LEGACY_THEME_STORAGE_KEY as LEGACY_STORAGE_KEY, COLOR_THEME_STORAGE_KEY as COLOR_STORAGE_KEY } from '../brand.js';

export type Theme = 'light' | 'dark';
export type ColorTheme = 'sunset' | 'aurora' | 'forest' | 'nebula' | 'glacier';

export interface ColorThemeDefinition {
  readonly id: ColorTheme;
  readonly label: string;
  readonly favicon: string;
  readonly dotClass: string;
  readonly description: string;
}

export const COLOR_THEMES: readonly ColorThemeDefinition[] = [
  {
    id: 'sunset',
    label: 'Sunset',
    favicon: '/favicon.svg',
    dotClass: 'bg-gradient-to-r from-amber-400 to-rose-500',
    description: 'ContextSpace classic warm twilight',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    favicon: '/favicon-aurora.svg',
    dotClass: 'bg-gradient-to-r from-teal-400 to-indigo-400',
    description: 'Cool boreal teal and cyan',
  },
  {
    id: 'forest',
    label: 'Forest',
    favicon: '/favicon-forest.svg',
    dotClass: 'bg-gradient-to-r from-emerald-400 to-teal-500',
    description: 'Lush emerald and pine',
  },
  {
    id: 'nebula',
    label: 'Nebula',
    favicon: '/favicon-nebula.svg',
    dotClass: 'bg-gradient-to-r from-pink-400 to-violet-500',
    description: 'Cosmic violet and vibrant magenta',
  },
  {
    id: 'glacier',
    label: 'Glacier',
    favicon: '/favicon-glacier.svg',
    dotClass: 'bg-gradient-to-r from-sky-300 to-blue-500',
    description: 'Crisp arctic slate and ice blue',
  },
] as const;

export function resolveFaviconPath(colorTheme: ColorTheme): string {
  const match = COLOR_THEMES.find((t) => t.id === colorTheme);
  return match?.favicon || '/favicon.svg';
}

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
  try {
    const stored = localStorage.getItem(COLOR_STORAGE_KEY);
    if (stored && COLOR_THEMES.some((t) => t.id === stored)) {
      return stored as ColorTheme;
    }
  } catch { /* Storage can be unavailable in embedded browsers. */ }
  return 'sunset';
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
    if (favicon) favicon.href = resolveFaviconPath(colorTheme);
    const frame = requestAnimationFrame(() => root.classList.remove('no-transitions'));
    return () => { cancelAnimationFrame(frame); root.classList.remove('no-transitions'); };
  }, [theme, colorTheme]);

  const setTheme = useCallback((next: Theme) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep in-memory selection working. */ }
    setThemeState(next);
  }, []);

  const setColorTheme = useCallback((next: ColorTheme) => {
    if (!COLOR_THEMES.some((t) => t.id === next)) return;
    try { localStorage.setItem(COLOR_STORAGE_KEY, next); } catch { /* Keep in-memory selection working. */ }
    setColorThemeState(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme, colorTheme, setColorTheme }}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
