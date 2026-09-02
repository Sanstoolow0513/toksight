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
  const ts = dayKeyToTs(String(value ?? '').trim());
  if (ts == null) throw new Error(`invalid date "${value}", expected YYYY-MM-DD`);
  return boundary === 'end' ? endOfDay(ts) : ts;
}

// Inverse of aggregate.localDate: 'YYYY-MM-DD' → that local day's midnight,
// or null when the string is not a calendar date. Unlike
// `Date.parse(`${key}T00:00:00`)` the contract is explicit and testable.
export function dayKeyToTs(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ''));
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  return new Date(y, mo - 1, d).getTime();
}

// First local midnight of the calendar month containing ts.
export function startOfMonth(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

// Every local midnight from startTs's day through endTs, inclusive, as an
// iterator. Snaps to local midnight first (an off-midnight start would shift
// the whole series by that offset) and steps calendar days — never +24h hops,
// which drift across DST transitions.
export function* eachDay(startTs, endTs) {
  const d = new Date(startOfDay(startTs));
  while (d.getTime() <= endTs) {
    yield d.getTime();
    d.setDate(d.getDate() + 1);
  }
}
