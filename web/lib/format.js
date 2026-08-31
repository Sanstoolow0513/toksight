// Number/time formatting for the dashboard. Mirrors the CLI's format.js
// conventions (adaptive cost decimals, K/M token units) but stays dependency
// free and locale-friendly for the UI.

export function fmtTokens(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs < 1000) return String(Math.round(v));
  if (abs < 1e6) return `${(v / 1e3).toFixed(abs < 1e5 ? 1 : 0)}K`;
  if (abs < 1e9) return `${(v / 1e6).toFixed(2)}M`;
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

export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
