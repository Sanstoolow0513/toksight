// Calendar periods and inclusive ranges for the report, keyed by
// plain YYYY-MM-DD strings so they compare lexically and never go through UTC.

const pad = (n) => String(n).padStart(2, '0');
export const QUICK_RANGES = ['1d', '7d', 'mtd', '30d'];

export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// `month` (1–12) is kept in year mode too, so switching back restores it.
export function currentPeriod(mode = 'month', now = new Date()) {
  return { mode, year: now.getFullYear(), month: now.getMonth() + 1 };
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
  return periodBounds(next).since > today ? currentPeriod(mode, parseKey(today)) : next;
}

export function quickPeriod(preset, today) {
  const since = preset === 'mtd' ? `${today.slice(0, 7)}-01` : shiftDay(today, -(Number.parseInt(preset, 10) - 1));
  return { mode: 'custom', preset, since, until: today };
}

export function validDay(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && dayKey(parseKey(key)) === key;
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
  date.setDate(date.getDate() + delta);
  return dayKey(date);
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
    out.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

// Monday = 0 … Sunday = 6.
export function weekdayIndex(key) {
  return (parseKey(key).getDay() + 6) % 7;
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
