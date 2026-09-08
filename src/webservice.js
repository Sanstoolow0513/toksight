import { collectAll, filterEntries } from './collect.js';
import { buildPayload } from './payload.js';
import { activityRange, buildHeatmap, buildTrend, buildTrendByAgent, buildWebExtras } from './webdata.js';
import { buildComparison } from './comparison.js';
import { buildCostCoverage } from './costcoverage.js';
import { resolveWebQuery } from './webquery.js';
import { calendarDaysBetween, endOfDay, startOfDay, stepDay } from './dates.js';
import { localDate } from './aggregate.js';

// Concurrent requests share collection, then independently filter and render.
// No settled result is cached, and no query can widen the CLI's startup scope.
export function createWebDataService(base, { collect = collectAll, env, home, now = Date.now } = {}) {
  let inflight = null;
  async function snapshot() {
    if (!inflight) {
      const run = Promise.resolve().then(() => collect({ ...base, clients: null, since: null, until: null }, { env, home }));
      inflight = run;
      run.then(() => { if (inflight === run) inflight = null; }, () => { if (inflight === run) inflight = null; });
    }
    return inflight;
  }
  return async (params = new URLSearchParams()) => {
    const time = now();
    let opts;
    try { opts = resolveWebQuery(params, base, time); }
    catch (err) { err.status = 400; err.code = 'BAD_QUERY'; throw err; }
    const raw = await snapshot();
    const filtered = filterEntries(raw.entries, opts);
    const ctx = { ...raw, opts, entries: filtered.entries, warnings: [...raw.warnings, ...filtered.warnings] };
    const scope = filterEntries(raw.entries, { ...base, clients: opts.clients }).entries;
    const payload = { ...buildPayload(ctx), ...buildWebExtras(ctx.entries, { top: opts.top, now: time }) };
    let selection = null;
    if (opts.since != null || opts.until != null) {
      const end = opts.until ?? endOfDay(time);
      const start = startOfDay(opts.since ?? activityRange(ctx.entries).firstAt ?? end);
      if (start <= end) {
        const fullDays = calendarDaysBetween(start, end) + 1;
        const days = Math.min(fullDays, 366);
        const shownStart = stepDay(end, -(days - 1));
        const weeks = Math.ceil((days + new Date(shownStart).getDay()) / 7);
        selection = {
          since: shownStart, until: end, truncated: fullDays > days,
          rows: buildTrend(ctx.entries, { days, now: end }),
          byAgent: buildTrendByAgent(ctx.entries, { days, now: end }),
          heatmap: buildHeatmap(ctx.entries, { weeks, now: end }),
        };
      }
    }
    return {
      ...payload,
      selection,
      costCoverage: buildCostCoverage(ctx.entries, raw),
      comparison: buildComparison(scope, opts, base, raw, time),
      view: {
        period: opts.period, today: localDate(time), availableClients: opts.availableClients,
        since: opts.since == null ? null : localDate(opts.since), until: opts.until == null ? null : localDate(opts.until),
        startup: { clients: base.clients, since: base.since == null ? null : localDate(base.since), until: base.until == null ? null : localDate(base.until) },
      },
    };
  };
}
