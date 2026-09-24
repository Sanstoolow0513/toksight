// Browser-only UI preferences (localStorage). Every reader validates what it
// finds, so a stale or hand-edited value falls back to the default.

import { DEFAULT_LOCALE, LOCALES } from './i18n.js';

export const CARD_IDS = ['heatmap', 'agents'];
export const THEMES = ['light', 'dark', 'system'];
const METRICS = ['tokens', 'cost'];

const KEYS = {
  locale: 'toksight-locale',
  theme: 'toksight-theme',
  order: 'toksight-card-order',
  mode: 'toksight-period-mode',
  metrics: 'toksight-card-metrics',
  dayMetric: 'toksight-day-metric',
};

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled: the preference just won't persist */
  }
}

function readJson(key) {
  try {
    return JSON.parse(read(key));
  } catch {
    return null;
  }
}

export function readLocale() {
  const v = read(KEYS.locale);
  return LOCALES.includes(v) ? v : DEFAULT_LOCALE;
}
export const writeLocale = (v) => write(KEYS.locale, v);

export function readTheme() {
  const v = read(KEYS.theme);
  return THEMES.includes(v) ? v : 'system';
}
export const writeTheme = (v) => write(KEYS.theme, v);

export function readMode() {
  return read(KEYS.mode) === 'year' ? 'year' : 'month';
}
export const writeMode = (v) => write(KEYS.mode, v);

export function readOrder() {
  const v = readJson(KEYS.order);
  if (!Array.isArray(v)) return CARD_IDS;
  const seen = new Set();
  const next = [];
  for (const id of v) {
    if (CARD_IDS.includes(id) && !seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }
  // A stored order from the retired models card still keeps heatmap/agents.
  return next.length === CARD_IDS.length ? next : CARD_IDS;
}
export const writeOrder = (v) => write(KEYS.order, JSON.stringify(v));

export function readMetrics() {
  const v = readJson(KEYS.metrics) ?? {};
  return Object.fromEntries(CARD_IDS.map((id) => [id, METRICS.includes(v[id]) ? v[id] : 'tokens']));
}
export const writeMetrics = (v) => write(KEYS.metrics, JSON.stringify(v));

export function readDayMetric() {
  const v = read(KEYS.dayMetric);
  return METRICS.includes(v) ? v : 'tokens';
}
export const writeDayMetric = (v) => write(KEYS.dayMetric, v);

export function resolveTheme(pref) {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Inlined into <head> so the first paint already has the right palette.
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem('${KEYS.theme}');var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})();`;
