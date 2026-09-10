'use client';

// Shared locale state for both pages: starts on the default (SSR-safe),
// re-reads localStorage on mount, mirrors the choice into
// document.documentElement.lang / document.title, and persists via
// writeStoredLocale. `tx` is t() pre-bound to the current locale.

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LOCALE, readStoredLocale, t, writeStoredLocale } from './i18n';

export function useLocale(titleKey) {
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);

  const setLocale = useCallback((next) => {
    setLocaleState(next);
    writeStoredLocale(next);
  }, []);

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t(locale, titleKey);
  }, [locale, titleKey]);

  const tx = useCallback((key, vars) => t(locale, key, vars), [locale]);

  return { locale, setLocale, tx };
}
