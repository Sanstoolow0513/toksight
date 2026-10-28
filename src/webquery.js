import { clients, resolveClientIds } from './clients/index.js';
import { endOfDay, parseDateArg, startOfDay, startOfMonth, stepDay, validateTimezone } from './dates.js';

// Optional `days=YYYY-MM-DD,…`: only these local calendar days (in the
// report time zone) within the range. Lets the Web calendar total a
// non-contiguous selection in one request.
export const MAX_QUERY_DAYS = 4000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
export function parseDayList(value) {
  const keys = String(value).split(',');
  if (keys.length > MAX_QUERY_DAYS) throw new Error(`days accepts at most ${MAX_QUERY_DAYS} dates`);
  for (const key of keys) {
    const match = DAY_KEY.exec(key);
    const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    if (!date || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3])) {
      throw new Error('days must be a comma-separated list of YYYY-MM-DD dates');
    }
  }
  return [...new Set(keys)].sort();
}

export function resolveWebQuery(params, base, now = Date.now()) {
  const allowed = new Set(['period', 'client', 'since', 'until', 'timezone', 'days']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new Error(`unknown or repeated query option: ${key}`);
  }
  const period = params.get('period') || 'all';
  const timezone = params.has('timezone') ? validateTimezone(params.get('timezone')) : undefined;
  if (!['all', 'today', '7d', '30d', 'month', 'custom'].includes(period)) throw new Error('invalid period');
  let since = params.has('since') ? parseDateArg(params.get('since'), 'start', timezone) : null;
  let until = params.has('until') ? parseDateArg(params.get('until'), 'end', timezone) : null;
  if (period === 'custom' && (since == null || until == null)) throw new Error('custom period requires since and until');
  if (period !== 'all' && period !== 'custom') {
    if (since != null || until != null) throw new Error('preset periods cannot include since/until');
    until = endOfDay(now, timezone);
    since = period === 'month' ? startOfMonth(now, timezone) : stepDay(startOfDay(now, timezone), period === '7d' ? -6 : period === '30d' ? -29 : 0, timezone);
  }
  if (since != null && until != null && since > until) throw new Error('since must not be after until');
  const days = params.has('days') ? parseDayList(params.get('days')) : null;
  let selected = params.has('client') ? resolveClientIds(params.get('client')) : null;
  if (params.has('client') && !selected?.length) throw new Error('client must not be empty');
  if (base.clients) selected = selected ? selected.filter((id) => base.clients.includes(id)) : base.clients;
  return {
    ...base,
    timezone,
    clients: selected,
    since: since == null ? base.since : base.since == null ? since : Math.max(since, base.since),
    until: until == null ? base.until : base.until == null ? until : Math.min(until, base.until),
    period,
    days,
    availableClients: Object.entries(clients).filter(([id]) => !base.clients || base.clients.includes(id)).map(([id, client]) => ({ id, label: client.label })),
  };
}
