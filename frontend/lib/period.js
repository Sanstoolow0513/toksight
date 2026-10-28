// Calendar periods and inclusive ranges for the report, keyed by
// plain YYYY-MM-DD strings so they compare lexically and never go through UTC.

const pad = (n) => String(n).padStart(2, '0');
export const QUICK_RANGES = ['1d', '7d', 'mtd', '30d'];

export function dayKey(date, timeZone) {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function validTimezone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 100 || /^[+-]/.test(zone)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
}

export function detectedTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function timezoneOptions(current) {
  const zones = Intl.supportedValuesOf?.('timeZone') ?? [];
  return [...new Set(['UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York', 'Europe/London', ...zones, current].filter(Boolean))].sort();
}

// Date labels are civil dates in the chosen reporting zone. Use a scratch UTC
// calendar only for arithmetic so the browser's own DST cannot skip a label.
const calendarKey = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// `month` (1–12) is kept in year mode too, so switching back restores it.
export function currentPeriod(mode = 'month', now = new Date(), timeZone) {
  return periodOf(dayKey(now, timeZone), mode);
}

export function periodBounds({ mode, year, month, since, until }) {
  if (mode === 'custom') return { since, until };
  if (mode === 'year') return { since: `${year}-01-01`, until: `${year}-12-31` };
  return { since: `${year}-${pad(month)}-01`, until: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}` };
}

// The `mode` period containing a local day.
export function periodOf(key, mode) {
  const [year, month] = key.split('-').map(Number);
  return { mode, year, month };
}

export function inPeriod(key, p) {
  const { since, until } = periodBounds(p);
  return key >= since && key <= until;
}

export function periodKey(p) {
  if (p.mode === 'custom') return `${p.since}_${p.until}`;
  return p.mode === 'year' ? String(p.year) : `${p.year}-${pad(p.month)}`;
}

export function shiftPeriod(p, delta) {
  if (p.mode === 'year') return { ...p, year: p.year + delta };
  const index = p.year * 12 + (p.month - 1) + delta;
  return { ...p, year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// A period that starts after today is clamped back to the one containing today.
export function withMode(p, mode, today) {
  const next = p.mode === 'custom' ? periodOf(p.until, mode) : { ...p, mode };
  return periodBounds(next).since > today ? periodOf(today, mode) : next;
}

export function quickPeriod(preset, today) {
  const since = preset === 'mtd' ? `${today.slice(0, 7)}-01` : shiftDay(today, -(Number.parseInt(preset, 10) - 1));
  return { mode: 'custom', preset, since, until: today };
}

export function validDay(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && calendarKey(parseKey(key)) === key;
}

// Inclusive local calendar days; a selected range cannot extend into the future.
export function validRange(since, until, today) {
  return validDay(since) && validDay(until) && since <= until && until <= today;
}

export function compactCalendar(period) {
  const { since, until } = periodBounds(period);
  return period.mode === 'year' || until > shiftDay(since, 61);
}

// `firstDay` is the earliest active local day in scope (null when there is
// no data at all), `today` the current local day.
export function periodNav(p, { firstDay, today }) {
  const { since, until } = periodBounds(p);
  return { canPrev: firstDay != null && firstDay < since, canNext: until < today };
}

export function shiftDay(key, delta) {
  const date = parseKey(key);
  date.setUTCDate(date.getUTCDate() + delta);
  return calendarKey(date);
}

// The day panel steps back to the first active day and never past today.
export function dayNav(key, { firstDay, today }) {
  return { canPrev: firstDay != null && firstDay < key, canNext: key < today };
}

export function eachDayKey(since, until) {
  const out = [];
  const cursor = parseKey(since);
  const end = parseKey(until);
  while (cursor <= end) {
    out.push(calendarKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// Monday = 0 … Sunday = 6.
export function weekdayIndex(key) {
  return (parseKey(key).getUTCDay() + 6) % 7;
}

// Whole Monday-start weeks covering the period; slots outside it are null.
export function calendarWeeks(since, until) {
  const weeks = [];
  let week = Array(weekdayIndex(since)).fill(null);
  for (const key of eachDayKey(since, until)) {
    week.push(key);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push([...week, ...Array(7 - week.length).fill(null)]);
  return weeks;
}

// ---- ISO weeks and the continuous calendar ------------------------------
// Pure civil-date arithmetic on integer day numbers (days since 1970-01-01 in
// the proleptic Gregorian calendar), so no clock or zone can shift a day.
function dayNumber(key) {
  let [y, m, d] = key.split('-').map(Number);
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400), yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function fromDayNumber(n) {
  const z = n + 719468, era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp + (mp < 10 ? 3 : -9);
  return `${era * 400 + yoe + (m <= 2 ? 1 : 0)}-${pad(m)}-${pad(d)}`;
}
// Monday = 0 … Sunday = 6 (1970-01-01 was a Thursday).
const isoWeekday = (n) => ((n % 7) + 7 + 3) % 7;

// ISO 8601 week: weeks start on Monday and week 1 holds January 4th, so the
// week belongs to the year of its Thursday.
export function isoWeek(key) {
  const n = dayNumber(key), thursday = n - isoWeekday(n) + 3;
  const year = Number(fromDayNumber(thursday).slice(0, 4));
  const jan4 = dayNumber(`${year}-01-04`);
  return { year, week: 1 + (thursday - (jan4 - isoWeekday(jan4) + 3)) / 7 };
}

export function mondayOf(key) {
  const n = dayNumber(key);
  return fromDayNumber(n - isoWeekday(n));
}

// The seven days (Monday to Sunday) of the week containing `key`.
export function weekKeys(key) {
  const monday = dayNumber(mondayOf(key));
  return Array.from({ length: 7 }, (_, i) => fromDayNumber(monday + i));
}

// "W43", or "26W1" when the week could be read against the wrong year: its
// ISO year differs from the month block's year, or it spans New Year.
export function weekLabelParts(key, blockYear) {
  const days = weekKeys(key), { year, week } = isoWeek(days[0]);
  const prefixed = year !== blockYear || days[0].slice(0, 4) !== days[6].slice(0, 4);
  return { year, week, prefix: prefixed ? String(year).slice(2) : null };
}

// Every { year, month } from the month of `first` to the month of `last`.
export function monthsBetween(first, last) {
  const out = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// Inclusive days between two keys in either order.
export function rangeKeys(a, b) {
  return a <= b ? eachDayKey(a, b) : eachDayKey(b, a);
}

// Sorted unique keys that form one unbroken run of days.
export function isContiguous(keys) {
  return keys.length > 0 && dayNumber(keys.at(-1)) - dayNumber(keys[0]) === keys.length - 1;
}
