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

export function fmtDateTime(ts) {
  if (ts == null) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
