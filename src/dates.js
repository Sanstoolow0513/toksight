// Shared local-time date helpers. This is the single home for day arithmetic:
// the CLI (--today/--week windows, --since/--until parsing), the web
// aggregations and the grouping code must never re-implement these, or the
// copies drift apart (the old cli.js endOfDay was a blind `+ 24h` and was off
// by an hour on DST transition days while webdata.js already stepped local
// midnights).

export function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// DST-safe day step on local midnights (never a blind `ts + n * 24h`): the
// latter drifts one hour per transition inside the span, which shifts window
// starts off their calendar day.
export function stepDay(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Last instant of the local day: step to the next local midnight, then back
// off 1ms. On DST days the local day is 23h or 25h long, so this stays inside
// the calendar day where `startOfDay(ts) + 24h` would not.
export function endOfDay(ts) {
  return stepDay(startOfDay(ts), 1) - 1;
}

// --since/--until values are local calendar dates (YYYY-MM-DD). The boundary
// is inclusive: 'end' maps to the last ms of that local day.
export function parseDateArg(value, boundary) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) throw new Error(`invalid date "${value}", expected YYYY-MM-DD`);
  const [, y, mo, d] = m.map(Number);
  if (boundary === 'end') {
    return new Date(y, mo - 1, d, 23, 59, 59, 999).getTime();
  }
  return new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
}
