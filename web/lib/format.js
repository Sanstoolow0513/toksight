// Number/time formatting for the dashboard. Mirrors the CLI's format.js
// conventions (adaptive cost decimals, K/M token units) but stays dependency
// free and locale-friendly for the UI.

export function fmtTokens(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs < 1000) return String(Math.round(v));
  if (abs < 1e6) return `${(v / 1e3).toFixed(abs < 1e5 ? 1 : 0)}K`;
  if (abs < 1e9) return `${(v / 1e6).toFixed(abs < 1e8 ? 2 : 1)}M`;
  return `${(v / 1e9).toFixed(2)}B`;
}

export function fmtCost(v) {
  if (v == null) return '—';
  const num = Number(v);
  const abs = Math.abs(num);
  if (abs >= 1000) return `$${Math.round(num).toLocaleString('en-US')}`;
  if (abs >= 1) return `$${num.toFixed(2)}`;
  if (abs >= 0.1) return `$${num.toFixed(3)}`;
  if (abs >= 0.0001) return `$${num.toFixed(4)}`;
  if (abs === 0) return '$0';
  return `$${num.toExponential(2)}`;
}

// Short enough for a calendar cell.
export function fmtCostShort(v) {
  const num = Number(v) || 0;
  const abs = Math.abs(num);
  if (abs === 0) return '$0';
  if (abs < 0.01) return '<$0.01';
  if (abs < 10) return `$${num.toFixed(2)}`;
  if (abs < 100) return `$${num.toFixed(1)}`;
  if (abs < 1000) return `$${Math.round(num)}`;
  return `$${(num / 1000).toFixed(1)}K`;
}

export function fmtMetric(v, metric, short = false) {
  if (metric === 'cost') return short ? fmtCostShort(v) : fmtCost(v);
  return fmtTokens(v);
}

export function fmtInt(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

export function fmtPct(p, digits = 1) {
  if (p == null || !Number.isFinite(p)) return '—';
  return `${(p * 100).toFixed(digits)}%`;
}

const pad2 = (n) => String(n).padStart(2, '0');

function toDate(ts) {
  if (ts == null) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDateTime(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Local wall-clock "HH:MM".
export function fmtClock(ts) {
  const d = toDate(ts);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '—';
}

// "09:12–11:40", a single time when both ends share a minute, null without times.
export function fmtClockRange(start, end) {
  if (toDate(start) == null) return null;
  const a = fmtClock(start);
  const b = toDate(end) == null ? a : fmtClock(end);
  return a === b ? a : `${a}–${b}`;
}
