// Dashboard grid layout model for the react-grid-layout v2 dashboard:
// default card positions on the 12-col grid (rowHeight 36px, margin 16px)
// plus validation for the persisted localStorage copy. Pure module — no
// React, no DOM — so node:test imports it directly (test/layout.test.js).

export const GRID_COLS = 12;
export const GRID_BREAKPOINT = 900;
export const LAYOUT_STORAGE_KEY = 'toksight-layout-v1';

const ITEMS = [
  { i: 'kpi-tokens', x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: 'kpi-cost', x: 3, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: 'kpi-cache', x: 6, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: 'kpi-days', x: 9, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
  { i: 'comparison', x: 0, y: 3, w: 12, h: 7, minW: 4, minH: 4 },
  { i: 'cost', x: 0, y: 10, w: 12, h: 5, minW: 4, minH: 3 },
  { i: 'trend', x: 0, y: 15, w: 12, h: 10, minW: 4, minH: 5 },
  { i: 'heatmap', x: 0, y: 25, w: 12, h: 6, minW: 4, minH: 4 },
  { i: 'agents', x: 0, y: 31, w: 5, h: 9, minW: 3, minH: 5 },
  { i: 'models', x: 5, y: 31, w: 7, h: 9, minW: 3, minH: 5 },
  { i: 'hour', x: 0, y: 40, w: 4, h: 6, minW: 3, minH: 4 },
  { i: 'month', x: 4, y: 40, w: 4, h: 6, minW: 3, minH: 4 },
  { i: 'rhythm', x: 8, y: 40, w: 4, h: 6, minW: 3, minH: 4 },
  { i: 'sessions', x: 0, y: 46, w: 12, h: 9, minW: 5, minH: 5 },
];

export const GRID_ITEM_IDS = ITEMS.map((item) => item.i);

export function defaultLayout() {
  return ITEMS.map((item) => ({ ...item }));
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Validate a persisted layout: unknown ids drop out, missing ids fall back
// to their default slot, sizes/positions clamp into the grid (minW/minH
// always come from the defaults — stored layouts only carry i/x/y/w/h).
// Anything structurally broken returns null so callers use the default.
export function sanitizeLayout(saved) {
  if (!Array.isArray(saved)) return null;
  const defaults = new Map(ITEMS.map((item) => [item.i, item]));
  const seen = new Set();
  const out = [];
  for (const item of saved) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const def = defaults.get(item.i);
    if (!def || seen.has(item.i)) continue;
    const { x, y, w, h } = item;
    if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    seen.add(item.i);
    const wClamped = clamp(Math.round(w), 1, GRID_COLS);
    out.push({
      ...def,
      x: clamp(Math.round(x), 0, GRID_COLS - wClamped),
      y: Math.max(Math.round(y), 0),
      w: wClamped,
      h: Math.max(Math.round(h), 1),
    });
  }
  for (const def of ITEMS) {
    if (!seen.has(def.i)) out.push({ ...def });
  }
  return out;
}
