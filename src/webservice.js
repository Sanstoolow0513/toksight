import { collectAll, filterEntries } from './collect.js';
import { buildPayload } from './payload.js';
import { activityRange, buildHeatmap, buildTrend, buildTrendByAgent, buildWebExtras } from './webdata.js';
import { buildComparison } from './comparison.js';
import { buildCostCoverage } from './costcoverage.js';
import { resolveWebQuery } from './webquery.js';
import { calendarDaysBetween, endOfDay, startOfDay, stepDay, weekday } from './dates.js';
import { localDate } from './aggregate.js';
import { createUsageDatabase } from './database.js';
import { getPricing, PRICE_REFRESH_MS } from './pricing.js';
import { parseCursorCsv } from './cursorcsv.js';
import { createCursorPriceLookup, cursorPriceRecords, getCursorPricing } from './cursorpricing.js';
import { getPublicPricing, PUBLIC_PRICE_SOURCES } from './publicpricing.js';

// The database is loaded before serving. Requests reuse its in-memory snapshot;
// refreshes share a single collection/write and swap only after commit.
export function createWebDataService(base, { collect = collectAll, env, home, database = createUsageDatabase({ env, home }), now = Date.now, cursorPricing = getCursorPricing, genericPricing = getPricing, publicPricing = getPublicPricing,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  let inflightRefresh = null;
  let inflightPrices = null;
  let initialized = false;
  let startupPricingWarnings = [];
  let timer = null, closed = false, inflightSetup = null;
  const assertOpen = () => { if (closed) throw new Error('web service is closed'); };
  function schedule() {
    if (timer) clearIntervalImpl(timer);
    timer = null;
    if (!base.offline && database.priceStatus().completed && database.priceStatus().autoUpdate) {
      timer = setIntervalImpl(() => { void updatePrices().catch((err) => { if (!closed) startupPricingWarnings = [err.message]; }); }, 60 * 60 * 1000);
      timer?.unref?.();
    }
  }
  async function refresh() {
    if (!inflightRefresh) {
      const run = Promise.resolve()
        .then(() => collect({ ...base, offline: true, clients: null, since: null, until: null }, { env, home }))
        .then((raw) => { assertOpen(); return database.replace(raw); })
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
    assertOpen();
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
      if (!force && !['cursor', ...Object.keys(PUBLIC_PRICE_SOURCES)].some(due)) return { updated: false, updates, warnings: [] };
      const [generic, cursor, publicRates] = await Promise.allSettled([
        genericPricing({ offline: true, force: false, env, home, now }),
        cursorPricing({ offline: base.offline, force, env, home, now }),
        publicPricing({ offline: base.offline, now, routerModels: current.entries.filter((e) => e.providerId === 'openrouter' || e.pricingProvider === 'openrouter' || e.model.startsWith('openrouter/'))
          .map((e) => e.model.replace(/^openrouter\//, '')) }),
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
      if (publicRates.status === 'fulfilled') {
        records.push(...publicRates.value.records); sources.push(...publicRates.value.sources);
        Object.assign(details, publicRates.value.sourceDetails);
        warnings.push(...publicRates.value.warnings);
      } else {
        warnings.push(`Public pricing unavailable; keeping saved prices (${publicRates.reason?.message || publicRates.reason})`);
        for (const [source, url] of Object.entries(PUBLIC_PRICE_SOURCES)) details[source] = { fetchedAt: null, state: 'unavailable', url };
      }
      assertOpen();
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
    if (database.priceStatus().completed && database.priceStatus().autoUpdate) await updatePrices();
    initialized = true;
    schedule();
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
    if (initialized && database.priceStatus().completed && database.priceStatus().autoUpdate) await updatePrices();
    const raw = await snapshot();
    const timezone = opts.timezone;
    const filtered = filterEntries(raw.entries, opts);
    const ctx = { ...raw, opts, entries: filtered.entries, warnings: [...raw.warnings, ...filtered.warnings, ...startupPricingWarnings] };
    const scope = filterEntries(raw.entries, { ...base, clients: opts.clients }).entries;
    const payload = { ...buildPayload(ctx), ...buildWebExtras(ctx.entries, { top: opts.top, now: time, timezone }) };
    let selection = null;
    if (opts.since != null || opts.until != null) {
      const end = opts.until ?? endOfDay(time, timezone);
      const start = startOfDay(opts.since ?? activityRange(ctx.entries).firstAt ?? end, timezone);
      if (start <= end) {
        const fullDays = calendarDaysBetween(start, end, timezone) + 1;
        const days = Math.min(fullDays, 366);
        const shownStart = stepDay(end, -(days - 1), timezone);
        const weeks = Math.ceil((days + weekday(shownStart, timezone)) / 7);
        selection = {
          since: shownStart, until: end, truncated: fullDays > days,
          rows: buildTrend(ctx.entries, { days, now: end, timezone }),
          byAgent: buildTrendByAgent(ctx.entries, { days, now: end, timezone }),
          heatmap: buildHeatmap(ctx.entries, { weeks, now: end, timezone }),
        };
      }
    }
    return {
      ...payload,
      priceDatabase: { ...database.priceStatus(), offline: Boolean(base.offline), updating: Boolean(inflightPrices) },
      snapshot: { refreshedAt: raw.refreshedAt, entries: raw.entries.length },
      scopeRange: activityRange(scope),
      selection,
      costCoverage: buildCostCoverage(ctx.entries, raw),
      comparison: buildComparison(scope, opts, base, raw, time),
      view: {
        period: opts.period, today: localDate(time, timezone), availableClients: opts.availableClients,
        since: opts.since == null ? null : localDate(opts.since, timezone), until: opts.until == null ? null : localDate(opts.until, timezone),
        startup: { clients: base.clients, since: base.since == null ? null : localDate(base.since, timezone), until: base.until == null ? null : localDate(base.until, timezone) },
      },
    };
  };
  getData.initialize = initialize;
  getData.refresh = refresh;
  getData.updatePrices = () => updatePrices(true);
  getData.priceStatus = () => ({ ...database.priceStatus(), offline: Boolean(base.offline), updating: Boolean(inflightPrices), warnings: startupPricingWarnings });
  getData.prices = (params = new URLSearchParams()) => {
    assertOpen();
    const keys = [...params.keys()], key = params.get('key');
    if (keys.some((name) => name !== 'key') || keys.length > 1 || (key != null && (!key || key.length > 8192))) {
      const err = new Error('invalid price query'); err.status = 400; err.code = 'BAD_QUERY'; throw err;
    }
    return { ...database.priceCatalog(key), offline: Boolean(base.offline), updating: Boolean(inflightPrices), warnings: startupPricingWarnings };
  };
  getData.setup = (options = {}) => {
    if (inflightSetup) return inflightSetup;
    if (typeof options !== 'object' || options == null || Array.isArray(options) ||
      Object.keys(options).some((key) => !['offline', 'autoUpdate'].includes(key)) ||
      ['offline', 'autoUpdate'].some((key) => Object.hasOwn(options, key) && typeof options[key] !== 'boolean')) {
      const err = new Error('invalid setup options'); err.status = 400; err.code = 'BAD_SETUP'; return Promise.reject(err);
    }
    const run = (async () => {
      await snapshot();
      let result = { warnings: [] };
      if (!options.offline && !base.offline) result = await updatePrices(true);
      else if (!database.priceStatus().completed && !base.offline) {
        // Continuing locally must not trigger an immediate download on the
        // very next report GET. Automatic checks can start after one hour.
        database.updatePriceCatalog({ records: [], sources: [], sourceDetails: Object.fromEntries([
          ...Object.entries(PUBLIC_PRICE_SOURCES), ['cursor', 'https://cursor.com/docs/models-and-pricing.md'],
        ].map(([source,url]) => [source,{fetchedAt:null,state:'deferred',url}])) }, new Date(now()).toISOString());
      }
      assertOpen();
      database.completeSetup({ autoUpdate: options.autoUpdate ?? true }, new Date(now()).toISOString());
      schedule();
      return { ...getData.priceStatus(), warnings: result.warnings };
    })();
    inflightSetup = run;
    run.then(() => { if (inflightSetup === run) inflightSetup = null; }, () => { if (inflightSetup === run) inflightSetup = null; });
    return run;
  };
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
  getData.close = () => { closed = true; if (timer) clearIntervalImpl(timer); timer = null; database.close(); };
  return getData;
}
