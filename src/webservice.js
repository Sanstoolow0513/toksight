import { collectAll, filterEntries } from './collect.js';
import { buildPayload } from './payload.js';
import { activityRange, buildHeatmap, buildTrend, buildTrendByAgent, buildWebExtras } from './webdata.js';
import { buildComparison } from './comparison.js';
import { buildCostCoverage } from './costcoverage.js';
import { resolveWebQuery } from './webquery.js';
import { calendarDaysBetween, endOfDay, startOfDay, stepDay } from './dates.js';
import { localDate } from './aggregate.js';
import { createUsageDatabase } from './database.js';
import { getPricing, PRICE_REFRESH_MS } from './pricing.js';
import { parseCursorCsv } from './cursorcsv.js';
import { createCursorPriceLookup, cursorPriceRecords, getCursorPricing } from './cursorpricing.js';

// The database is loaded before serving. Requests reuse its in-memory snapshot;
// refreshes share a single collection/write and swap only after commit.
export function createWebDataService(base, { collect = collectAll, env, home, database = createUsageDatabase({ env, home }), now = Date.now, cursorPricing = getCursorPricing, genericPricing = getPricing } = {}) {
  let inflightRefresh = null;
  let inflightPrices = null;
  let initialized = false;
  let startupPricingWarnings = [];
  async function refresh() {
    if (!inflightRefresh) {
      const run = Promise.resolve()
        .then(() => collect({ ...base, clients: null, since: null, until: null }, { env, home }))
        .then((raw) => database.replace(raw))
        .then((current) => {
          if (current.pricing.sources.cursor !== 'unavailable') startupPricingWarnings = [];
          return current;
        });
      inflightRefresh = run;
      run.then(() => { if (inflightRefresh === run) inflightRefresh = null; }, () => { if (inflightRefresh === run) inflightRefresh = null; });
    }
    const raw = await inflightRefresh;
    return { refreshedAt: raw.refreshedAt, entries: raw.entries.length, database: database.file, warnings: raw.warnings };
  }
  async function updatePrices(force = false) {
    if (force && base.offline) {
      const err = new Error('price updates require an online web session');
      err.status = 400; err.code = 'PRICE_OFFLINE'; throw err;
    }
    if (inflightPrices) return inflightPrices;
    const run = (async () => {
      let current = database.read();
      if (!current) { await refresh(); current = database.read(); }
      const time = now();
      const updates = current.pricing.updates ?? {};
      const due = (source) => {
        const fetched = Date.parse(updates[source]?.fetchedAt ?? '');
        const checked = Date.parse(updates[source]?.checkedAt ?? '');
        if (Number.isFinite(checked) && time - checked < 60 * 60 * 1000 && !force) return false;
        return !Number.isFinite(fetched) || time - fetched >= PRICE_REFRESH_MS;
      };
      if (!force && !due('litellm') && !due('cursor')) return { updated: false, updates, warnings: [] };
      const [generic, cursor] = await Promise.allSettled([
        genericPricing({ offline: base.offline, force, env, home, now }),
        cursorPricing({ offline: base.offline, force, env, home, now }),
      ]);
      const records = [], sources = [], details = {}, warnings = [];
      if (generic.status === 'fulfilled') {
        records.push(...(generic.value.records ?? []));
        sources.push('builtin', 'user');
        if (records.some((record) => record.source === 'litellm')) sources.push('litellm');
        Object.assign(details, generic.value.sourceDetails);
        warnings.push(...(generic.value.warnings ?? []));
      } else {
        warnings.push(`LiteLLM pricing unavailable (${generic.reason?.message || generic.reason})`);
        details.litellm = { fetchedAt: null, url: null, state: 'unavailable' };
      }
      if (cursor.status === 'fulfilled') {
        const cursorRecords = cursorPriceRecords(cursor.value.models);
        records.push(...cursorRecords);
        if (cursorRecords.length) sources.push('cursor');
        details.cursor = { fetchedAt: cursor.value.fetchedAt, url: cursor.value.source, state: cursor.value.state };
        warnings.push(...(cursor.value.warnings ?? []));
      } else {
        if (!base.offline) warnings.push(`Cursor pricing unavailable (${cursor.reason?.message || cursor.reason})`);
        details.cursor = { fetchedAt: null, url: null, state: base.offline ? 'skipped (offline)' : 'unavailable' };
      }
      const latest = database.updatePriceCatalog({ records, sourceDetails: details, sources }, new Date(time).toISOString());
      startupPricingWarnings = warnings;
      return { updated: true, updates: latest.pricing.updates, warnings };
    })();
    inflightPrices = run;
    try { return await run; }
    finally { if (inflightPrices === run) inflightPrices = null; }
  }
  async function initialize() {
    if (!database.read()) await refresh();
    await updatePrices();
    initialized = true;
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
    if (initialized) await updatePrices();
    const raw = await snapshot();
    const filtered = filterEntries(raw.entries, opts);
    const ctx = { ...raw, opts, entries: filtered.entries, warnings: [...raw.warnings, ...filtered.warnings, ...startupPricingWarnings] };
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
  getData.updatePrices = () => updatePrices(true);
  getData.exportDatabase = async () => {
    await snapshot();
    return database.exportDatabase();
  };
  getData.importDatabase = async (bytes) => {
    // An already running scan commits first; imported history then survives
    // all later scans through its own durable table.
    if (inflightRefresh) await inflightRefresh;
    return database.importDatabase(bytes);
  };
  getData.importCursor = async (csv) => {
    const parsed = parseCursorCsv(csv);
    await snapshot();
    let cursorRates = null;
    const warnings = [...parsed.warnings];
    if (parsed.records.some((record) => record.included)) {
      try {
        const result = await cursorPricing({ offline: base.offline, env, home });
        cursorRates = { priceFor: createCursorPriceLookup(result.models), records: cursorPriceRecords(result.models),
          sourceDetails: { cursor: { fetchedAt: result.fetchedAt, url: result.source, state: result.state } }, state: result.state };
        warnings.push(...result.warnings);
        startupPricingWarnings = [];
      } catch (err) {
        warnings.push(`Cursor pricing unavailable; Included usage may remain unpriced (${err.message})`);
      }
    }
    const { imported, duplicates, updated, snapshot: current } = database.importCursor(parsed.records, undefined, cursorRates);
    let latestAt = null;
    for (const { entry } of parsed.records) {
      if (latestAt == null || entry.timestamp > latestAt) latestAt = entry.timestamp;
    }
    return {
      imported, duplicates, updated, skipped: parsed.skipped, zeroUsage: parsed.zeroUsage,
      rows: parsed.rows, latestAt, entries: current.entries.length, warnings,
    };
  };
  getData.close = () => database.close();
  return getData;
}
