import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'nexusflow-theme';

/**
 * Dark is forced while legacy screens are still pinned to fixed dark values
 * (see legacy-compat.css). Flip to false in phase B5 to expose light mode.
 */
const FORCE_DARK = true;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', setTheme: () => {} });

function resolveInitialTheme(): Theme {
  if (FORCE_DARK) return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    // Suppress transitions for the swap so the whole page doesn't animate.
    root.classList.add('no-transitions');
    root.classList.toggle('dark', theme === 'dark');
    requestAnimationFrame(() => root.classList.remove('no-transitions'));
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    if (FORCE_DARK) return;
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
