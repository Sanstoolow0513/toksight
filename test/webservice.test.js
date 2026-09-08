import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWebDataService } from '../src/webservice.js';
import { resolveWebQuery } from '../src/webquery.js';
import { buildCostCoverage } from '../src/costcoverage.js';
import { getPricing } from '../src/pricing.js';
import { parseArgs } from '../src/args.js';
import { calendarDaysBetween, parseDateArg } from '../src/dates.js';
import { localDate } from '../src/aggregate.js';
import { createWebServer } from '../src/webserver.js';

const base = parseArgs(['--offline']);
const now = () => new Date(2026, 8, 8, 12).getTime();
const at = (day) => new Date(2026, 8, day, 12).getTime();
const entry = (over = {}) => ({ client: 'claude', model: 'model-a', sessionId: 's1', timestamp: at(8), inputTokens: 100, outputTokens: 10, reasoningTokens: 0, cacheReadTokens: 50, cacheWriteTokens: 0, costUsd: 1, directory: null, title: null, ...over });
const raw = (entries) => ({ entries, warnings: [], perClient: [], reportedCosts: new WeakSet(), pricing: { priceFor: () => ({ source: 'builtin' }), sources: { builtin: true }, configDir: '/fixture' } });
const service = (entries, opts = base) => createWebDataService(opts, { collect: async () => raw(entries), now });
const query = (text) => new URLSearchParams(text);

test('concurrent filters share collection without sharing filtered payloads, and later calls re-collect', async () => {
  let count = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const get = createWebDataService(base, { now, collect: async () => {
    count++; await gate;
    return raw([entry(), entry({ client: 'codex', costUsd: 3, sessionId: 's2' })]);
  } });
  const a = get(query('client=claude')), b = get(query('client=codex'));
  await Promise.resolve(); release();
  const [claude, codex] = await Promise.all([a, b]);
  assert.equal(count, 1);
  assert.deepEqual(Object.keys(claude.clients), ['claude']);
  assert.deepEqual(Object.keys(codex.clients), ['codex']);
  assert.equal(claude.totals.costUsd, 1); assert.equal(codex.totals.costUsd, 3);
  await get(query('client=claude')); assert.equal(count, 2);
});

test('a failed collection is not cached', async () => {
  let count = 0;
  const get = createWebDataService(base, { now, collect: async () => {
    if (++count === 1) throw new Error('fixture failure');
    return raw([entry()]);
  } });
  await assert.rejects(get(), /fixture failure/);
  assert.equal((await get()).totals.requests, 1);
});

test('invalid dates, ranges, agents and duplicate parameters fail before collection', async () => {
  let count = 0;
  const get = createWebDataService(base, { now, collect: async () => { count++; return raw([]); } });
  for (const value of ['period=bad', 'since=2026-02-30', 'since=2026-13-01', 'since=2026-09-09&until=2026-09-08', 'client=unknown', 'client=constructor', 'client=__proto__', 'client=', 'period=custom', 'period=7d&since=2026-09-01', 'since=2026-09-01&since=2026-09-02', 'offline=true']) {
    await assert.rejects(get(query(value)), (err) => err.status === 400 && err.code === 'BAD_QUERY', value);
  }
  assert.equal(count, 0);
  assert.throws(() => parseDateArg('2026-02-30', 'start'), /invalid date/);
});

test('filters intersect the startup scope; previous periods outside it are unavailable', async () => {
  const opts = parseArgs(['--offline', '--client', 'claude', '--since', '2026-09-05', '--until', '2026-09-07']);
  const get = service([entry({ timestamp: at(4) }), entry({ timestamp: at(6) }), entry({ client: 'codex', timestamp: at(6) }), entry({ timestamp: at(8) })], opts);
  const data = await get(query('period=30d'));
  assert.equal(data.totals.requests, 1);
  assert.deepEqual(data.view.availableClients.map((agent) => agent.id), ['claude']);
  assert.equal(data.view.since, '2026-09-05'); assert.equal(data.view.until, '2026-09-07');
  assert.equal(data.comparison.reason, 'startup-range');
  assert.equal((await get(query('client=codex'))).totals.requests, 0);
  const empty = await get(query('since=2026-09-08'));
  assert.equal(empty.totals.requests, 0); assert.equal(empty.comparison.reason, 'empty-range');
});

test('historical selected charts agree with all filtered slices and missing timestamps warn', async () => {
  const entries = [entry({ timestamp: at(1) }), entry({ timestamp: at(2) }), entry({ timestamp: at(3) }), entry({ timestamp: null }), entry({ client: 'codex', timestamp: at(1) })];
  const data = await service(entries)(query('client=claude&period=custom&since=2026-09-01&until=2026-09-02'));
  assert.equal(data.totals.requests, 2);
  assert.equal(data.models[0].requests, 2);
  assert.equal(data.clients.claude.requests, 2);
  assert.equal(data.monthly[0].requests, 2);
  assert.equal(data.topSessions[0].requests, 2);
  assert.deepEqual(data.selection.rows.map((row) => row.date), ['2026-09-01', '2026-09-02']);
  assert.equal(data.selection.rows.reduce((sum, row) => sum + row.tokens, 0), data.totals.totalTokens);
  assert.equal(data.selection.heatmap.days.reduce((sum, row) => sum + row.tokens, 0), data.totals.totalTokens);
  assert.equal(data.costCoverage.requests, 2);
  assert.ok(data.warnings.some((warning) => warning.includes('without a timestamp')));
});

test('long selected charts are capped without capping totals or comparison', async () => {
  const data = await service([entry({ timestamp: new Date(2024, 0, 1).getTime() }), entry()])(query('since=2024-01-01&until=2026-09-08'));
  assert.equal(data.totals.requests, 2);
  assert.equal(data.selection.rows.length, 366);
  assert.equal(data.selection.truncated, true);
  assert.ok(data.comparison.days > 366);
});

test('comparison includes discontinued and newly used models and reconciles their deltas', async () => {
  const entries = [entry({ timestamp: at(1), model: 'old-only', costUsd: 4 }), entry({ timestamp: at(7), model: 'new-only', costUsd: 9 }), entry({ client: 'codex', timestamp: at(1), costUsd: 2 }), entry({ client: 'codex', timestamp: at(7), costUsd: 1 })];
  const { comparison: c } = await service(entries)(query('period=7d'));
  assert.equal(c.days, 7);
  assert.equal(localDate(c.current.since), '2026-09-02');
  assert.equal(localDate(c.previous.since), '2026-08-26');
  assert.equal(localDate(c.previous.until), '2026-09-01');
  assert.equal(c.delta.costUsd, 4);
  assert.equal(c.byClient.reduce((sum, row) => sum + row.costDelta, 0), 4);
  assert.equal(c.byModel.reduce((sum, row) => sum + row.costDelta, 0), 4);
  assert.equal(c.byModel.find((row) => row.model === 'old-only').costDelta, -4);
  assert.equal(c.partialCurrent, true);
});

test('zero baseline, missing records, unknown costs and pooled cache ratios are explicit', async () => {
  const data = await service([entry({ timestamp: at(7), costUsd: null }), entry({ timestamp: at(8), inputTokens: 50, cacheReadTokens: 150 }), entry({ timestamp: null })])(query('period=7d'));
  assert.equal(data.comparison.costChangePercent, null);
  assert.equal(data.comparison.previous.totals.requests, 0);
  assert.equal(data.comparison.current.costCoverage.unpricedRequests, 1);
  assert.equal(data.comparison.current.cacheHitRate, 200 / 350);
  assert.equal(data.comparison.delta.cacheHitRate, null);
  assert.equal(data.costCoverage.unpricedRequests, 1);
});

test('rounding noise is not reported as a cost change', async () => {
  const data = await service([entry({ timestamp: at(1), costUsd: 0.1 }), entry({ timestamp: at(1), costUsd: 0.2 }), entry({ costUsd: 0.3 })])(query('period=7d'));
  assert.equal(data.comparison.delta.costUsd, 0);
  assert.equal(data.comparison.costChangePercent, 0);
  assert.equal(data.comparison.byModel[0].costDelta, 0);
});

test('real collection preserves agent-reported cost provenance alongside computed estimates', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'toksight-provenance-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { TOKSIGHT_CONFIG_DIR: path.join(home, 'pricing'), OPENCODE_PATH: path.join(home, 'opencode') };
  const messages = path.join(env.OPENCODE_PATH, 'storage', 'message', 'sess1');
  await mkdir(messages, { recursive: true });
  await cp(new URL('./fixtures/opencode/storage/message/sess1/msg1.json', import.meta.url), path.join(messages, 'msg1.json'));
  const project = path.join(home, '.claude', 'projects', 'fixture');
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, 'session.jsonl'), JSON.stringify({ type: 'assistant', sessionId: 'claude-fixture', timestamp: '2026-09-08T10:00:00Z', message: { id: 'm', model: 'claude-sonnet-4-5', usage: { input_tokens: 100, output_tokens: 10 } } }));
  const get = createWebDataService(base, { home, env, now });
  const data = await get();
  assert.ok(data.costCoverage.sources.reported.requests > 0);
  assert.equal(data.costCoverage.sources.builtin.requests, 1);
  assert.equal(data.costCoverage.sources.reported.costUsd, data.clients.opencode.costUsd);
});

test('calendar comparisons keep equal day counts through DST', async (t) => {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'America/New_York';
  t.after(() => { if (previousTZ == null) delete process.env.TZ; else process.env.TZ = previousTZ; });
  const spring = new Date(2026, 2, 9, 12).getTime();
  assert.equal(calendarDaysBetween(new Date(2026, 2, 7), new Date(2026, 2, 9)), 2);
  const get = createWebDataService(base, { collect: async () => raw([]), now: () => spring });
  const data = await get(query('since=2026-03-07&until=2026-03-09'));
  assert.equal(data.comparison.days, 3);
  assert.equal(localDate(data.comparison.previous.since), '2026-03-04');
  assert.equal(localDate(data.comparison.previous.until), '2026-03-06');
  assert.equal(data.selection.rows.length, 3);
  assert.notEqual(data.comparison.current.until - data.comparison.current.since, data.comparison.previous.until - data.comparison.previous.since);
});

test('cost coverage separates reports, estimates, unpriced requests and actual cache fallbacks', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'toksight-cost-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { TOKSIGHT_CONFIG_DIR: home };
  await writeFile(path.join(home, 'pricing.json'), JSON.stringify({ custom: { input: 2, output: 4 }, explicit: { input: 2, output: 4, cacheRead: 2, cacheWrite: 2 } }));
  await mkdir(path.join(home, 'cache'));
  await writeFile(path.join(home, 'cache', 'litellm-pricing.json'), JSON.stringify({ fetchedAt: Date.now(), data: { remote: { input_cost_per_token: 0.000002, output_cost_per_token: 0.000004 } } }));
  const pricing = await getPricing({ home, env }); // Fresh local fixture: no fetch.
  const reported = entry({ client: 'opencode', model: 'custom', costUsd: 7 });
  const coverage = buildCostCoverage([
    reported, entry({ model: 'custom' }), entry({ model: 'explicit' }), entry({ model: 'remote' }), entry({ model: 'claude-sonnet-4-5', cacheReadTokens: 0 }), entry({ costUsd: null }),
  ], { pricing, reportedCosts: new WeakSet([reported]) });
  assert.equal(coverage.sources.reported.costUsd, 7);
  assert.equal(coverage.sources.user.requests, 2);
  assert.equal(coverage.sources.litellm.requests, 1);
  assert.equal(coverage.sources.builtin.requests, 1);
  assert.equal(coverage.cacheFallbackRequests, 2); // explicit equal prices and reported costs are not fallbacks.
  assert.equal(coverage.unpricedRequests, 1);
});

test('web API forwards filters and returns useful 400 errors', async () => {
  const server = createWebServer({ port: 0, outDir: os.tmpdir(), getData: service([entry(), entry({ client: 'codex' })]) });
  const { url } = await server.start();
  try {
    const selected = await fetch(url + '/api/data?client=codex&period=7d');
    assert.equal(selected.status, 200);
    assert.deepEqual(Object.keys((await selected.json()).clients), ['codex']);
    const invalid = await fetch(url + '/api/data?since=2026-02-30');
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'BAD_QUERY');
  } finally { await server.close(); }
});
