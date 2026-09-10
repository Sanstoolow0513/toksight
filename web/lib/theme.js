'use client';

// Theme state for both pages: 'system' (default) follows the OS via
// prefers-color-scheme, 'light'/'dark' are explicit overrides persisted in
// localStorage. The resolved theme is mirrored into
// document.documentElement.dataset.theme, which globals.css keys its dark
// token overrides on. app/layout.js carries an inline pre-paint script that
// sets the same attribute before first paint, so returning visitors with a
// dark preference never see a light flash.

import { useCallback, useEffect, useState } from 'react';

export const THEME_KEY = 'toksight-theme';
export const THEMES = ['system', 'light', 'dark'];

export function readStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (THEMES.includes(v)) return v;
  } catch {
    /* private mode */
  }
  return 'system';
}

export function writeStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

// The pre-paint snippet in app/layout.js duplicates this logic — keep the
// storage key and the system-query semantics in sync with it.
export function resolveTheme(theme, systemDark) {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return systemDark;
}

export function useTheme() {
  const [theme, setThemeState] = useState('system');
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setThemeState(readStoredTheme());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const dark = resolveTheme(theme, systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    writeStoredTheme(next);
  }, []);

  return { theme, dark, setTheme };
}
