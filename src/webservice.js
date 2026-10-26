import { collectAll, filterEntries } from './collect.js';
import { activityRange, buildHeatmap, buildTrend, buildTrendByAgent, buildWebExtras } from './webdata.js';
import { buildComparison } from './comparison.js';
import { buildCostCoverage } from './costcoverage.js';
import { resolveWebQuery } from './webquery.js';
import { calendarDaysBetween, endOfDay, startOfDay, stepDay, weekday } from './dates.js';
import { localDate } from './aggregate.js';
import { createUsageDatabase } from './database.js';
import { getPricing, PRICE_REFRESH_MS } from './pricing.js';
import { PRICE_SOURCES, validPriceSources } from './priceselection.js';
import { resetPriceDatabase } from './pricereset.js';
import { collectQuotas, QUOTA_CLIENTS } from './quota.js';
import { buildPayload, buildQuotaPayload } from './payload.js';

// The database is loaded before serving. Requests reuse its in-memory snapshot;
// refreshes share a single collection/write and swap only after commit.
export function createWebDataService(base, { collect = collectAll, env, home, database = createUsageDatabase({ env, home }), now = Date.now, genericPricing = getPricing,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval, quotaFetch } = {}) {
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
      timer = setIntervalImpl(() => {
        if (database.priceStatus().completed && database.priceStatus().autoUpdate) {
          void updatePrices().catch((err) => { if (!closed) startupPricingWarnings = [err.message]; });
        }
      }, 60 * 60 * 1000);
      timer?.unref?.();
    }
  }
  async function refresh() {
    if (!inflightRefresh) {
      const run = Promise.resolve()
        .then(() => collect({ ...base, offline: true, clients: null, since: null, until: null }, { env, home }))
        .then((raw) => { assertOpen(); return database.replace(raw); })
        .then((current) => {
          if (!String(current.pricing.sources.litellm).startsWith('unavailable')) startupPricingWarnings = [];
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
      const selectedSources = database.priceStatus().selectedSources;
      const due = (source) => {
        const fetched = Date.parse(updates[source]?.fetchedAt ?? '');
        const checked = Date.parse(updates[source]?.checkedAt ?? '');
        if (Number.isFinite(checked) && time - checked < 60 * 60 * 1000 && !force) return false;
        return !Number.isFinite(fetched) || time - fetched >= PRICE_REFRESH_MS;
      };
      if (!force && !selectedSources.some(due)) return { updated: false, updates, warnings: [] };
      const records = [], sources = [], details = {}, warnings = [];
      try {
        const generic = await genericPricing({ offline: base.offline, force, env, home, now, selectedSources });
        records.push(...(generic.records ?? []));
        sources.push('user');
        if (records.some((record) => record.source === 'litellm')) sources.push('litellm');
        Object.assign(details, generic.sourceDetails);
        warnings.push(...(generic.warnings ?? []));
      } catch (err) {
        warnings.push(`LiteLLM pricing unavailable; keeping saved prices (${err?.message || err})`);
        details.litellm = { fetchedAt: null, url: null, state: 'unavailable' };
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
  getData.resetPrices = () => {
    assertOpen();
    if (inflightRefresh || inflightPrices || inflightSetup) {
      const err = new Error('Wait for the current refresh, import or price update before resetting prices');
      err.status = 409; err.code = 'PRICE_BUSY'; throw err;
    }
    resetPriceDatabase(database, { env, home });
    startupPricingWarnings = [];
    schedule();
    return getData.priceStatus();
  };
  getData.priceStatus = () => ({ ...database.priceStatus(), availableSources: PRICE_SOURCES, offline: Boolean(base.offline), updating: Boolean(inflightPrices), warnings: startupPricingWarnings });
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
      Object.keys(options).some((key) => !['offline', 'autoUpdate', 'selectedSources'].includes(key)) ||
      ['offline', 'autoUpdate'].some((key) => Object.hasOwn(options, key) && typeof options[key] !== 'boolean') ||
      (Object.hasOwn(options, 'selectedSources') && !validPriceSources(options.selectedSources))) {
      const err = new Error('invalid setup options'); err.status = 400; err.code = 'BAD_SETUP'; return Promise.reject(err);
    }
    const run = (async () => {
      await snapshot();
      if (inflightPrices) await inflightPrices;
      if (options.selectedSources) database.selectPriceSources(options.selectedSources);
      let result = { warnings: [] };
      if (!options.offline && !base.offline) result = await updatePrices(true);
      else if (!database.priceStatus().completed && !base.offline) {
        // Continuing locally must not trigger an immediate download on the
        // very next report GET. Automatic checks can start after one hour.
        database.updatePriceCatalog({ records: [], sources: [], sourceDetails: {
          litellm: { fetchedAt: null, state: 'deferred', url: null },
        } }, new Date(now()).toISOString());
      }
      if (options.offline || base.offline) {
        const local = await genericPricing({ offline: true, env, home, selectedSources: [] });
        assertOpen();
        database.updatePriceCatalog({ records: (local.records ?? []).filter((record) => record.source === 'user'),
          sources: ['user'], sourceDetails: {} }, new Date(now()).toISOString());
        result.warnings.push(...(local.warnings ?? []));
      }
      assertOpen();
      database.completeSetup({ autoUpdate: options.autoUpdate ?? database.priceStatus().autoUpdate }, new Date(now()).toISOString());
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
  // Quota: GET re-reads Codex logs and returns the last Kimi result held in
  // memory (never persisted); only the explicit refresh calls the Kimi API.
  let kimiQuota = null, inflightQuota = null;
  const kimiCache = { get: () => kimiQuota, set: (value) => { kimiQuota = value; } };
  const quotaClients = () => base.clients ? QUOTA_CLIENTS.filter((id) => base.clients.includes(id)) : QUOTA_CLIENTS;
  const quotaPayload = async (network) => ({
    ...buildQuotaPayload(await collectQuotas({ clients: quotaClients(), offline: Boolean(base.offline), network },
      { env, home, now, fetchImpl: quotaFetch, kimiCache }), now()),
    offline: Boolean(base.offline),
  });
  getData.quota = () => { assertOpen(); return quotaPayload(false); };
  getData.refreshQuota = () => {
    assertOpen();
    if (!inflightQuota) {
      const run = quotaPayload(true);
      inflightQuota = run;
      run.then(() => { if (inflightQuota === run) inflightQuota = null; }, () => { if (inflightQuota === run) inflightQuota = null; });
    }
    return inflightQuota;
  };
  getData.close = () => { closed = true; if (timer) clearIntervalImpl(timer); timer = null; database.close(); };
  return getData;
}
