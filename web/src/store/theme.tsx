import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { sidebarThemes, defaultThemeKey, type SidebarTheme } from '../theme/sidebarThemes';

const STORAGE_KEY = 'sidebar-theme';

interface ThemeContextValue {
  themeKey: string;
  themeConfig: SidebarTheme;
  setTheme: (key: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyCSSVariables(t: SidebarTheme) {
  const root = document.documentElement;
  root.style.setProperty('--warm-sidebar', t.sidebarBg);
  root.style.setProperty('--warm-sidebar-title', t.titleColor);
  root.style.setProperty('--warm-sidebar-selected', t.selectedBg);
  root.style.setProperty('--warm-sidebar-hover', t.hoverBg);
  root.style.setProperty('--warm-sidebar-submenu', t.subMenuBg);
  root.style.setProperty('--warm-table-header-bg', t.tableHeaderBg);
  root.style.setProperty('--warm-table-header-color', t.tableHeaderColor);
  root.style.setProperty('--warm-table-header-border', t.tableHeaderBorder);
  root.style.setProperty('--warm-search-bar-bg', t.searchBarBg);
  root.style.setProperty('--warm-search-bar-border', t.searchBarBorder);
}

function getInitialKey(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && sidebarThemes[stored]) return stored;
  return defaultThemeKey;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeKey, setThemeKey] = useState(getInitialKey);
  const themeConfig = sidebarThemes[themeKey] || sidebarThemes[defaultThemeKey];

  useEffect(() => {
    applyCSSVariables(themeConfig);
  }, [themeConfig]);

  const setTheme = useCallback((key: string) => {
    if (!sidebarThemes[key]) return;
    setThemeKey(key);
    localStorage.setItem(STORAGE_KEY, key);
  }, []);

  return (
    <ThemeContext.Provider value={{ themeKey, themeConfig, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
