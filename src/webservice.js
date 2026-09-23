import { collectAll, filterEntries } from './collect.js';
import { buildPayload } from './payload.js';
import { activityRange, buildHeatmap, buildTrend, buildTrendByAgent, buildWebExtras } from './webdata.js';
import { buildComparison } from './comparison.js';
import { buildCostCoverage } from './costcoverage.js';
import { resolveWebQuery } from './webquery.js';
import { calendarDaysBetween, endOfDay, startOfDay, stepDay } from './dates.js';
import { localDate } from './aggregate.js';
import { createUsageDatabase } from './database.js';

// The database is loaded before serving. Requests reuse its in-memory snapshot;
// refreshes share a single collection/write and swap only after commit.
export function createWebDataService(base, { collect = collectAll, env, home, database = createUsageDatabase({ env, home }), now = Date.now } = {}) {
  let inflightRefresh = null;
  async function refresh() {
    if (!inflightRefresh) {
      const run = Promise.resolve()
        .then(() => collect({ ...base, clients: null, since: null, until: null }, { env, home }))
        .then((raw) => database.replace(raw));
      inflightRefresh = run;
      run.then(() => { if (inflightRefresh === run) inflightRefresh = null; }, () => { if (inflightRefresh === run) inflightRefresh = null; });
    }
    const raw = await inflightRefresh;
    return { refreshedAt: raw.refreshedAt, entries: raw.entries.length, database: database.file, warnings: raw.warnings };
  }
  async function initialize() {
    if (!database.read()) await refresh();
  }
  async function snapshot() {
    const current = database.read();
    if (current) return current;
    await refresh();
    return database.read();
  }
  const getData = async (params = new URLSearchParams()) => {
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
      snapshot: { refreshedAt: raw.refreshedAt, entries: raw.entries.length },
      scopeRange: activityRange(scope),
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
  getData.initialize = initialize;
  getData.refresh = refresh;
  getData.close = () => database.close();
  return getData;
}
