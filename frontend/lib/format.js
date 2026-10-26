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

const shortTokens = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });
const tinyTokens = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 2 });

// Small calendar cells use fewer digits; labels and details retain precision.
export function fmtTokensShort(n, digits = 3) {
  return (digits === 2 ? tinyTokens : shortTokens).format(Number(n) || 0);
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

export function fmtDateTime(ts, timeZone) {
  const d = toDate(ts);
  if (!d) return '—';
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Local wall-clock "HH:MM".
export function fmtClock(ts, timeZone) {
  const d = toDate(ts);
  if (d && timeZone) return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '—';
}

// "09:12–11:40", a single time when both ends share a minute, null without times.
export function fmtClockRange(start, end, timeZone) {
  if (toDate(start) == null) return null;
  const a = fmtClock(start, timeZone);
  const b = toDate(end) == null ? a : fmtClock(end, timeZone);
  return a === b ? a : `${a}–${b}`;
}
