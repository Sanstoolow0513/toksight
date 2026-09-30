// Shared local-time date helpers. This is the single home for day arithmetic:
// the CLI (--today/--week windows, --since/--until parsing), the web
// aggregations and the grouping code must never re-implement these, or the
// copies drift apart (the old cli.js endOfDay was a blind `+ 24h` and was off
// by an hour on DST transition days while webdata.js already stepped local
// midnights).

// Explicit zones are request-scoped. Never change process.env.TZ: concurrent
// browser reports may use different zones while CLI dates keep their meaning.
const formatters = new Map();
const midnights = new Map();
const pad = (n) => String(n).padStart(2, '0');

export function validateTimezone(value) {
  if (typeof value !== 'string' || !value || value.length > 100 || /^[+-]/.test(value)) throw new Error('invalid timezone');
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new Error('invalid timezone'); }
}

export function dateParts(ts, timeZone) {
  const d = new Date(ts);
  if (typeof timeZone !== 'string') return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours() };
  if (!formatters.has(timeZone)) {
    if (formatters.size >= 64) formatters.clear();
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }));
  }
  return Object.fromEntries(formatters.get(timeZone).formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
}

export function dateKey(ts, timeZone) {
  if (!Number.isFinite(ts)) return 'unknown';
  const p = dateParts(ts, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function weekday(ts, timeZone) {
  const p = dateParts(ts, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

// UTC is only a scratch calendar for arithmetic on date labels, never the
// reporting zone. Find the first instant of a zoned date, including days whose
// clocks skip or repeat midnight. Cache boundaries across aggregation passes.
function zonedMidnight(key, nominal, timeZone) {
  const cacheKey = `${timeZone}/${key}`;
  if (midnights.has(cacheKey)) return midnights.get(cacheKey);
  let lo = nominal - 36 * 3600000, hi = nominal + 36 * 3600000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (dateKey(mid, timeZone) < key) lo = mid + 1;
    else hi = mid;
  }
  if (midnights.size >= 8192) midnights.clear();
  midnights.set(cacheKey, lo);
  return lo;
}

export function startOfDay(ts, timeZone) {
  if (timeZone) return dayKeyToTs(dateKey(ts, timeZone), timeZone);
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// DST-safe day step on local midnights (never a blind `ts + n * 24h`): the
// latter drifts one hour per transition inside the span, which shifts window
// starts off their calendar day.
export function stepDay(ts, n, timeZone) {
  if (timeZone) {
    const p = dateParts(ts, timeZone);
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
    const key = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const boundary = zonedMidnight(key, d.getTime(), timeZone);
    // A jurisdiction can skip an entire date (e.g. Samoa in 2011). A
    // backwards step must still make progress past that missing date.
    return n < 0 && dateKey(boundary, timeZone) > key ? startOfDay(boundary - 1, timeZone) : boundary;
  }
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Last instant of the local day: step to the next local midnight, then back
// off 1ms. On DST days the local day is 23h or 25h long, so this stays inside
// the calendar day where `startOfDay(ts) + 24h` would not.
export function endOfDay(ts, timeZone) {
  return stepDay(startOfDay(ts, timeZone), 1, timeZone) - 1;
}

// --since/--until values are local calendar dates (YYYY-MM-DD). The boundary
// is inclusive: 'end' maps to the last ms of that local day.
export function parseDateArg(value, boundary, timeZone) {
  const ts = dayKeyToTs(String(value ?? '').trim(), timeZone);
  if (ts == null) throw new Error(`invalid date "${value}", expected YYYY-MM-DD`);
  return boundary === 'end' ? endOfDay(ts, timeZone) : ts;
}

// Inverse of aggregate.localDate: 'YYYY-MM-DD' → that local day's midnight,
// or null when the string is not a calendar date. Unlike
// `Date.parse(`${key}T00:00:00`)` the contract is explicit and testable.
export function dayKeyToTs(key, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  if (timeZone) {
    const nominal = Date.UTC(y, mo - 1, d);
    const date = new Date(nominal);
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
    const ts = zonedMidnight(key, nominal, timeZone);
    return dateKey(ts, timeZone) === key ? ts : null;
  }
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

// Difference in calendar dates, independent of 23/25-hour local days.
export function calendarDaysBetween(start, end, timeZone) {
  const ordinal = (ts) => {
    const p = dateParts(ts, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day);
  };
  return Math.round((ordinal(end) - ordinal(start)) / 86400000);
}

// First local midnight of the calendar month containing ts.
export function startOfMonth(ts, timeZone) {
  if (timeZone) return dayKeyToTs(`${dateKey(ts, timeZone).slice(0, 7)}-01`, timeZone);
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

// Every local midnight from startTs's day through endTs, inclusive, as an
// iterator. Snaps to local midnight first (an off-midnight start would shift
// the whole series by that offset) and steps calendar days — never +24h hops,
// which drift across DST transitions.
export function* eachDay(startTs, endTs, timeZone) {
  if (timeZone) {
    for (let ts = startOfDay(startTs, timeZone); ts <= endTs; ts = stepDay(ts, 1, timeZone)) yield ts;
    return;
  }
  const d = new Date(startOfDay(startTs));
  while (d.getTime() <= endTs) {
    yield d.getTime();
    d.setDate(d.getDate() + 1);
  }
}
