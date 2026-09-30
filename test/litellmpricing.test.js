import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { computeCost, getPricing } from '../src/pricing.js';
import { createPriceLookup, priceRecord } from '../src/pricecatalog.js';
import { createUsageDatabase } from '../src/database.js';
import { readDatabaseBackup } from '../src/dbtransfer.js';
import { readStoredPriceFor } from '../src/usageimports.js';
import { collectAll } from '../src/collect.js';
import { buildPayload } from '../src/payload.js';
import { createWebDataService } from '../src/webservice.js';

const catalog = JSON.parse(await readFile(new URL('./fixtures/pricing/litellm.json', import.meta.url), 'utf8'));
const opts = { offline: true, clients: null, since: null, until: null, top: 20 };
const entry = (extra = {}) => ({ client: 'claude', model: 'tiered-model', sessionId: 'one',
  timestamp: Date.parse('2026-09-01T12:00:00Z'), inputTokens: 250000, outputTokens: 1000,
  cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: null, directory: null, title: null, ...extra });
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

async function fixture(t, data = catalog) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-lite-test-'));
  const cleanup = [];
  t.after(async () => { for (const close of cleanup) close(); await rm(dir, { recursive: true, force: true }); });
  const env = { TOKSIGHT_CONFIG_DIR: path.join(dir, 'config'), CLAUDE_CONFIG_DIR: path.join(dir, 'claude'),
    CODEX_HOME: path.join(dir, 'codex'), OPENCODE_PATH: path.join(dir, 'opencode'),
    ZCODE_HOME: path.join(dir, 'zcode'), KIMI_CODE_HOME: path.join(dir, 'kimi') };
  const cache = path.join(env.TOKSIGHT_CONFIG_DIR, 'cache');
  await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, 'litellm-pricing.json'), JSON.stringify({ fetchedAt: Date.now(), data }));
  const pricing = await getPricing({ offline: true, env, home: dir });
  return { dir, env, home: dir, pricing, cleanup };
}

test('LiteLLM aliases and dated Opus snapshots retain their exact rates in either catalog order', async (t) => {
  const { pricing } = await fixture(t);
  for (const records of [pricing.records, [...pricing.records].reverse()]) {
    const lookup = createPriceLookup(records);
    for (const name of ['claude-opus-4-5', 'claude-opus-4-5-20251101', 'claude-opus-4-6', 'claude-opus-4-6-20260205', 'anthropic/claude-opus-4-5']) {
      const rate = lookup(name);
      assert.equal(rate.source, 'litellm', name);
      assert.deepEqual([rate.input, rate.output, rate.cacheRead, rate.cacheWrite], [5e-6, 25e-6, 0.5e-6, 6.25e-6]);
    }
  }
});

test('exact snapshot, provider and fine-tuning keys win before safe, unambiguous aliases', () => {
  const rate = (name, input, provider = null, source = 'litellm') => priceRecord({ name, source, provider,
    input, output: input * 2, cacheRead: input, cacheWrite: input });
  const records = [rate('model', 1, 'example'), rate('model-20260101', 2, 'example'), rate('model-2026-02-01', 3, 'example'),
    rate('ft:model', 9), rate('one/ambiguous', 1), rate('two/ambiguous', 1),
    rate('dated-only-20260101', 2), rate('dated-only-20260201', 2),
    rate('conflict-20260101', 2), rate('conflict-20260201', 3), rate('example/model', 4, null, 'user')];
  const lookup = createPriceLookup(records.slice(0, -1));
  for (const [name, expected] of [['model', 1], ['model-20260101', 2], ['model-2026-02-01', 3],
    ['example/model', 1], ['example/model-20260101', 2], ['ft:model', 9], ['model-20260301', 1],
    ['builtin:MODEL:latest', 1], ['dated-only', 2], ['one/ambiguous', 1]]) assert.equal(lookup(name)?.input, expected, name);
  for (const name of ['ambiguous', 'conflict', 'other/model', 'ft:unknown', 'model-fast', 'model-2']) assert.equal(lookup(name), null, name);
  assert.equal(createPriceLookup(records)('model').source, 'user');
  const suffixed = createPriceLookup([rate('model', 1), rate('example/model-20260101', 2)]);
  assert.equal(suffixed('model-20260101').input, 2);
});

test('context thresholds use each request including cache tokens, never output or session totals', async (t) => {
  const { pricing } = await fixture(t);
  const price = (extra) => pricing.priceFor('tiered-model', 'claude', entry(extra));
  assert.equal(price({ inputTokens: 200000, outputTokens: 999999 }).input, 1e-6);
  assert.equal(price({ inputTokens: 200001 }).input, 2e-6);
  const cached = price({ inputTokens: 100000, cacheReadTokens: 100000, cacheWriteTokens: 1 });
  assert.deepEqual([cached.input, cached.output, cached.cacheRead, cached.cacheWrite], [2e-6, 3e-6, 0, 2.5e-6]);
  assert.equal(cached.cacheReadFallback, false);
  assert.equal(cached.cacheWriteFallback, false);
  assert.equal(price({ inputTokens: 272000 }).input, 2e-6);
  const largest = price({ inputTokens: 272001 });
  assert.deepEqual([largest.input, largest.output, largest.cacheRead, largest.cacheWrite], [4e-6, 6e-6, 0.2e-6, 4e-6]);
  assert.equal(largest.cacheWriteFallback, true);
  assert.equal(pricing.priceFor('tiered-model').input, 1e-6, 'no request returns the base rate');
  assert.equal(price({ inputTokens: 100000 }).input, 1e-6, 'prior lookups do not mutate the catalog');
  assert.deepEqual(pricing.priceFor('tiered-model').contextTiers.map((r) => r.contextOver), [200000, 272000]);
  const gemini = entry({ model: 'gemini/gemini-2.5-pro' });
  closeTo(computeCost(gemini, pricing.priceFor(gemini.model, gemini.client, gemini)), 0.64);
  assert.equal(computeCost({ ...gemini, costUsd: 0.12 }, pricing.priceFor(gemini.model, gemini.client, gemini)), 0.12);
});

test('invalid context rates are skipped, xAI thresholds are inclusive, and user prices still win', async (t) => {
  const data = { model: { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6,
    input_cost_per_token_above_0_tokens: 3e-6, input_cost_per_token_above_100k_tokens: -1,
    input_cost_per_token_above_200k_tokens: 2e-6, output_cost_per_token_above_200k_tokens: 'bad',
    input_cost_per_token_above_300k_tokens: 3e-6 },
    'xai/model': { litellm_provider: 'xai', input_cost_per_token: 1e-6, output_cost_per_token: 2e-6,
      input_cost_per_token_above_200k_tokens: 2e-6 } };
  const ctx = await fixture(t, data);
  assert.deepEqual(ctx.pricing.priceFor('model').contextTiers.map((r) => r.contextOver), [300000]);
  const rate = ctx.pricing.priceFor('xai/model', 'opencode', entry({ inputTokens: 200000 }));
  assert.equal(rate.input, 2e-6);
  assert.equal(rate.output, 2e-6);
  assert.equal(rate.cacheRead, 2e-6);
  assert.equal(rate.cacheReadFallback, true);
  await writeFile(path.join(ctx.env.TOKSIGHT_CONFIG_DIR, 'pricing.json'), JSON.stringify({ model: { input: 7, output: 8 } }));
  const overridden = await getPricing({ ...ctx, offline: true });
  assert.equal(overridden.priceFor('model', 'claude', entry({ inputTokens: 500000 })).input, 7e-6);
});

test('CLI collection, Web snapshots, price updates, reopen and offline backups apply the same context prices', async (t) => {
  const ctx = await fixture(t);
  const project = path.join(ctx.env.CLAUDE_CONFIG_DIR, 'projects', 'example');
  await mkdir(project, { recursive: true });
  const rows = [entry({ inputTokens: 100000 }), entry()];
  await writeFile(path.join(project, 'session.jsonl'), rows.map((e, i) => JSON.stringify({ type: 'assistant',
    sessionId: e.sessionId, timestamp: new Date(e.timestamp).toISOString(), message: { id: `msg-${i}`, model: e.model,
      usage: { input_tokens: e.inputTokens, output_tokens: e.outputTokens } } })).join('\n'));
  const raw = await collectAll(opts, ctx);
  closeTo(raw.entries[0].costUsd, 0.102);
  closeTo(raw.entries[1].costUsd, 0.503);
  const payload = buildPayload({ ...raw, opts });
  assert.equal(payload.pricing.modelRates[0].variableRates, true);
  assert.equal(payload.pricing.modelRates[0].source, null);
  assert.equal('input' in payload.pricing.modelRates[0], false);
  const longOnly = buildPayload({ ...raw, entries: [raw.entries[1]], opts });
  assert.equal(longOnly.pricing.modelRates[0].input, 2);
  const file = path.join(ctx.dir, 'source.sqlite');
  let db = createUsageDatabase({ file });
  ctx.cleanup.push(() => db.close());
  const reported = entry({ sessionId: 'reported', costUsd: 7 });
  db.replace({ ...raw, entries: [...raw.entries, reported], reportedCosts: new WeakSet([reported]) });
  db.close();
  db = createUsageDatabase({ file });
  closeTo(db.read().entries[1].costUsd, 0.503);
  const saved = readStoredPriceFor(file);
  assert.equal(saved('tiered-model', 'claude', rows[1]).input, 2e-6);
  const updated = raw.pricing.records.map((r) => r.name === 'tiered-model'
    ? { ...r, contextTiers: r.contextTiers.map((tier) => ({ ...tier, input: tier.input * 2 })) } : r);
  db.updatePriceCatalog({ records: updated, sources: ['litellm'] });
  closeTo(db.read().entries[0].costUsd, 0.102);
  closeTo(db.read().entries[1].costUsd, 1.003);
  assert.equal(db.read().entries[2].costUsd, 7);
  const destination = await fixture(t, {});
  const target = createUsageDatabase({ env: destination.env });
  destination.cleanup.push(() => target.close());
  const bytes = db.exportDatabase();
  assert.ok(readDatabaseBackup(bytes).catalog.find((r) => r.name === 'tiered-model').contextTiers.length);
  target.importDatabase(bytes);
  closeTo(target.read().entries[1].costUsd, 1.003);
  const cli = await collectAll(opts, destination);
  closeTo(cli.entries[1].costUsd, 1.003);
  assert.equal(cli.entries[2].costUsd, 7);
  const service = createWebDataService(opts, { ...destination, database: target });
  destination.cleanup.push(() => service.close());
  const web = await service(new URLSearchParams('client=claude'));
  closeTo(web.totals.costUsd, 8.105);
  assert.equal(web.pricing.modelRates[0].variableRates, true);
});

test('backups preserve distinct snapshot prices and reject malformed context metadata atomically', async (t) => {
  const ctx = await fixture(t, { model: { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 },
    'model-20260101': { input_cost_per_token: 3e-6, output_cost_per_token: 4e-6 } });
  const source = createUsageDatabase({ file: ':memory:' }), target = createUsageDatabase({ file: ':memory:' });
  ctx.cleanup.push(() => { source.close(); target.close(); });
  source.replace({ entries: [entry({ model: 'model' }), entry({ model: 'model-20260101' })],
    warnings: [], pricing: ctx.pricing, reportedCosts: new WeakSet() });
  target.replace({ entries: [], warnings: [], reportedCosts: new WeakSet(), pricing: {
    ...ctx.pricing, records: ctx.pricing.records.filter((r) => r.name !== 'model-20260101') } });
  target.importDatabase(source.exportDatabase());
  assert.equal(target.read().pricing.priceFor('model-20260101').input, 3e-6);
  const initial = target.read();
  const file = path.join(ctx.dir, 'invalid.sqlite');
  await writeFile(file, source.exportDatabase());
  const sql = new DatabaseSync(file);
  const invalid = JSON.stringify({ contextTiers: [{ contextOver: 200000, input: -1 }] });
  sql.prepare('UPDATE model_prices SET metadata_json = ? WHERE name = ?').run(invalid, 'model');
  sql.close();
  const invalidBytes = await readFile(file);
  assert.throws(() => target.importDatabase(invalidBytes), { code: 'BAD_DATABASE' });
  assert.strictEqual(target.read(), initial);
});

test('legacy snapshot and imported builtin estimates cannot restore family-prefix pricing', async (t) => {
  const ctx = await fixture(t, {});
  const db = createUsageDatabase({ env: ctx.env });
  ctx.cleanup.push(() => db.close());
  const legacy = priceRecord({ name: 'claude-opus-4', source: 'builtin',
    input: 15e-6, output: 75e-6, cacheRead: 1.5e-6, cacheWrite: 18.75e-6 });
  const estimated = entry({ model: 'claude-opus-4-6', costUsd: 9 });
  const reported = entry({ model: estimated.model, sessionId: 'reported', costUsd: 9 });
  db.replace({ entries: [estimated, reported], warnings: [], reportedCosts: new WeakSet([reported]),
    pricing: { sources: { builtin: true }, configDir: ctx.env.TOKSIGHT_CONFIG_DIR, priceFor: () => legacy, records: [legacy] } });
  assert.equal(db.read().pricing.priceFor(estimated.model), null);
  assert.equal(db.read().entries[0].costUsd, null);
  assert.equal(db.read().entries[1].costUsd, 9);
  db.importDatabase(db.exportDatabase());
  const cli = await collectAll(opts, ctx);
  assert.equal(cli.entries[0].costUsd, null);
  assert.equal(cli.entries[1].costUsd, 9);
});
