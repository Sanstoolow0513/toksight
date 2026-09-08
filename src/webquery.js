import { clients, resolveClientIds } from './clients/index.js';
import { endOfDay, parseDateArg, startOfDay, startOfMonth, stepDay } from './dates.js';

export function resolveWebQuery(params, base, now = Date.now()) {
  const allowed = new Set(['period', 'client', 'since', 'until']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new Error(`unknown or repeated query option: ${key}`);
  }
  const period = params.get('period') || 'all';
  if (!['all', 'today', '7d', '30d', 'month', 'custom'].includes(period)) throw new Error('invalid period');
  let since = params.has('since') ? parseDateArg(params.get('since'), 'start') : null;
  let until = params.has('until') ? parseDateArg(params.get('until'), 'end') : null;
  if (period === 'custom' && (since == null || until == null)) throw new Error('custom period requires since and until');
  if (period !== 'all' && period !== 'custom') {
    if (since != null || until != null) throw new Error('preset periods cannot include since/until');
    until = endOfDay(now);
    since = period === 'month' ? startOfMonth(now) : stepDay(startOfDay(now), period === '7d' ? -6 : period === '30d' ? -29 : 0);
  }
  if (since != null && until != null && since > until) throw new Error('since must not be after until');
  let selected = params.has('client') ? resolveClientIds(params.get('client')) : null;
  if (params.has('client') && !selected?.length) throw new Error('client must not be empty');
  if (base.clients) selected = selected ? selected.filter((id) => base.clients.includes(id)) : base.clients;
  return {
    ...base,
    clients: selected,
    since: since == null ? base.since : base.since == null ? since : Math.max(since, base.since),
    until: until == null ? base.until : base.until == null ? until : Math.min(until, base.until),
    period,
    availableClients: Object.entries(clients).filter(([id]) => !base.clients || base.clients.includes(id)).map(([id, client]) => ({ id, label: client.label })),
  };
}
