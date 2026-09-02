// The user-facing `--json` contract. The web API reuses this exact shape
// (`GET /api/data`) and layers the src/webdata.js extras on top, so this
// module must stay presentation-free — it is the data layer both the CLI
// renderer and the HTTP server feed from.

import { createRequire } from 'node:module';

import * as agg from './aggregate.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// `ctx` is what collectAll returns plus the parsed opts:
// { entries, warnings, pricing, perClient, opts }.
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
    models: agg.byModel(entries).map((r) => ({
      client: r.client,
      model: r.model,
      ...r.totals,
      cacheHitRate: agg.cacheHitRate(r.totals),
      firstAt: r.firstAt === Infinity ? null : r.firstAt,
      lastAt: r.lastAt || null,
    })),
    daily: agg.byDay(entries).map((r) => ({ date: r.key, ...r.totals, cacheHitRate: agg.cacheHitRate(r.totals) })),
    monthly: agg.byMonth(entries).map((r) => ({ month: r.key, ...r.totals, cacheHitRate: agg.cacheHitRate(r.totals) })),
    sessions: agg.bySession(entries).slice(0, opts.top).map((r) => ({
      client: r.client,
      sessionId: r.sessionId,
      directory: r.directory,
      title: r.title,
      models: r.models,
      ...r.totals,
      cacheHitRate: agg.cacheHitRate(r.totals),
      firstAt: r.firstAt === Infinity ? null : r.firstAt,
      lastAt: r.lastAt || null,
    })),
    pricing: {
      sources: pricing.sources,
      configDir: pricing.configDir,
      unpricedModels: agg.unpricedModels(entries),
    },
    warnings,
  };
}
