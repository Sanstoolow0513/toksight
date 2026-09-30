// The user-facing `--json` contract. The web API reuses this exact shape
// (`GET /api/data`) and layers the src/webdata.js extras on top, so this
// module must stay presentation-free — it is the data layer both the CLI
// renderer and the HTTP server feed from.

import { createRequire } from 'node:module';

import * as agg from './aggregate.js';
import { modelIdentity, reportModelName } from './pricecatalog.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

function modelRateRows(entries, pricing) {
  const groups = new Map(), rows = [];
  for (const entry of entries) {
    const key = `${entry.client}\0${entry.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const parts = ['input', 'cacheRead', 'cacheWrite', 'output'];
  for (const group of groups.values()) {
    const entry = group[0];
    const baseRate = pricing.priceFor?.(entry.model, entry.client);
    const applied = group.map((e) => pricing.priceFor?.(e.model, e.client, e));
    const rate = applied[0];
    const consistent = applied.every((r) => r?.source === rate?.source && parts.every((part) => r?.[part] === rate?.[part]));
    const validRate = consistent && rate && parts.every((part) => Number.isFinite(rate[part]));
    const identity = modelIdentity(entry.model, entry.client, baseRate);
    rows.push({
      client: entry.client, scope: entry.client === 'cursor' ? 'cursor' : 'default',
      model: entry.model, displayModel: reportModelName(entry.model, entry.client, baseRate),
      modelId: baseRate?.modelId ?? identity.id,
      effort: identity.effort, source: validRate ? rate.source : null, pool: rate?.pool ?? null,
      ...(entry.client === 'cursor' ? { maxMode: Boolean(identity.maxMode), variableRates: !consistent,
        priceFetchedAt: rate?.cursor?.fetchedAt ?? null, retained: Boolean(rate?.cursor?.retained) } : {}),
      ...(validRate ? { input: rate.input * 1e6, cacheRead: rate.cacheRead * 1e6,
        cacheWrite: rate.cacheWrite * 1e6, output: rate.output * 1e6 } : {}),
    });
  }
  return rows;
}

// `ctx` is what collectAll returns plus the parsed opts:
// { entries, warnings, pricing, perClient, opts }. Note the split: `entries`
// is the post-filter list everything below aggregates from, while
// perClient[].entries keeps each agent's unfiltered parse output — the
// unfiltered view the `env` command and empty-state page render.
export function buildPayload(ctx) {
  const { entries, warnings, pricing, opts } = ctx;
  const totals = agg.summarize(entries);
  return {
    tool: 'toksight',
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    range: { since: opts.since, until: opts.until },
    clientsFilter: opts.clients,
    totals,
    cacheHitRate: agg.cacheHitRate(totals),
    // Per-agent totals from the filtered entries, so --since/--until/--client
    // apply here just like they do to every other slice of the payload.
    clients: Object.fromEntries(
      agg.byClient(entries).map((r) => [r.client, { ...r.totals, cacheHitRate: agg.cacheHitRate(r.totals) }]),
    ),
    models: agg.byModel(entries, pricing.priceFor).map((r) => ({
      client: r.client,
      model: r.model,
      modelIds: r.modelIds,
      ...r.totals,
      cacheHitRate: agg.cacheHitRate(r.totals),
      firstAt: r.firstAt,
      lastAt: r.lastAt,
    })),
    daily: agg.byDay(entries, opts.timezone).map((r) => ({ date: r.key, ...r.totals, cacheHitRate: agg.cacheHitRate(r.totals) })),
    monthly: agg.byMonth(entries, opts.timezone).map((r) => ({ month: r.key, ...r.totals, cacheHitRate: agg.cacheHitRate(r.totals) })),
    sessions: agg.bySession(entries, pricing.priceFor).slice(0, opts.top).map((r) => ({
      client: r.client,
      sessionId: r.sessionId,
      directory: r.directory,
      title: r.title,
      models: r.models,
      ...r.totals,
      cacheHitRate: agg.cacheHitRate(r.totals),
      firstAt: r.firstAt,
      lastAt: r.lastAt,
    })),
    pricing: {
      sources: pricing.sources,
      configDir: pricing.configDir,
      unpricedModels: agg.unpricedModels(entries, pricing.priceFor),
      updates: pricing.updates ?? pricing.sourceDetails ?? {},
      modelRates: modelRateRows(entries, pricing),
    },
    warnings,
  };
}
