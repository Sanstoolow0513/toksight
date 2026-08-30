const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  magenta: 35,
  cyan: 36,
  gray: 90,
};

export function createFormatter({ color = true } = {}) {
  const paint = color
    ? (s, code) => `\x1b[${code}m${s}\x1b[0m`
    : (s) => s;

  const fmt = {
    colorEnabled: color,
    dim: (s) => paint(s, CODES.dim),
    bold: (s) => paint(s, CODES.bold),
    cyan: (s) => paint(s, CODES.cyan),
    yellow: (s) => paint(s, CODES.yellow),
    gray: (s) => paint(s, CODES.gray),
  };

  fmt.int = (n) => Math.round(n).toLocaleString('en-US');

  fmt.tokens = (n) => {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (abs < 1000) return String(Math.round(v));
    if (abs < 1e6) return `${(v / 1e3).toFixed(abs < 1e5 ? 1 : 0)}K`;
    if (abs < 1e9) return `${(v / 1e6).toFixed(2)}M`;
    return `${(v / 1e9).toFixed(2)}B`;
  };

  fmt.cost = (v) => {
    if (v == null) return '—';
    const abs = Math.abs(v);
    if (abs >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`;
    if (abs >= 1) return `$${v.toFixed(2)}`;
    if (abs >= 0.1) return `$${v.toFixed(3)}`;
    if (abs >= 0.0001) return `$${v.toFixed(4)}`;
    if (abs === 0) return '$0.0000';
    const decimals = Math.min(12, 3 + Math.ceil(-Math.log10(abs)));
    return `$${v.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1')}`;
  };

  fmt.pct = (p) => (p == null ? '—' : `${(p * 100).toFixed(1)}%`);

  fmt.datetime = (ts) => {
    if (ts == null || !Number.isFinite(ts)) return 'unknown';
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
  };

  return fmt;
}

export function renderTable({ columns, rows }) {
  const cells = rows.map((row) => columns.map((col) => col.value(row)));
  const widths = columns.map((col, i) =>
    Math.max(col.header.length, ...cells.map((row) => row[i].length)),
  );
  const pad = (s, w, align) => (align === 'right' ? s.padStart(w) : s.padEnd(w));

  const lines = [
    columns.map((col, i) => pad(col.header, widths[i], col.align)).join('  '),
    widths.map((w) => '─'.repeat(w)).join('  '),
    ...rows.map((_, ri) =>
      cells[ri].map((s, i) => pad(s, widths[i], columns[i].align)).join('  '),
    ),
  ];
  return lines.join('\n');
}
