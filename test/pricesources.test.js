import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { getPricing, LITELLM_URL } from '../src/pricing.js';
import { DEFAULT_PRICE_SOURCES } from '../src/priceselection.js';
import { createPriceLookup } from '../src/pricecatalog.js';
import { createUsageDatabase } from '../src/database.js';
import { readStoredPriceFor } from '../src/usageimports.js';
import { createWebDataService } from '../src/webservice.js';
import { parseArgs } from '../src/args.js';

const usage = { client: 'opencode', model: 'gpt-example', sessionId: 'session', timestamp: Date.parse('2026-10-02T00:00:00Z'),
  inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: null, directory: null, title: null };
const raw = (records = [], entries = [usage]) => ({ entries, warnings: [], reportedCosts: new WeakSet(),
  pricing: { records, priceFor: createPriceLookup(records), sources: {}, configDir: '/fixture' } });
const model = (provider, extra = {}) => ({ mode: 'chat', litellm_provider: provider, input_cost_per_token: 2e-6, output_cost_per_token: 4e-6, ...extra });
async function fixture(t, data) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-source-choice-'));
  const cleanup = [];
  t.after(async () => { for (const close of cleanup) close(); await rm(dir, { recursive: true, force: true }); });
  const env = { TOKSIGHT_CONFIG_DIR: dir };
  await mkdir(path.join(dir, 'cache'));
  await writeFile(path.join(dir, 'cache', 'litellm-pricing.json'), JSON.stringify({ fetchedAt: Date.now(), data }));
  return { dir, env, cleanup };
}

test('LiteLLM downloads once and admits only first-party chat/responses prices, including cached input and free rates', async (t) => {
  const { dir, env } = await fixture(t, {});
  const calls = [];
  const data = { 'gpt-example': model('openai'), 'gemini/gemini-example': model('gemini'),
    'mistral/devstral-example': model('mistral'), 'zai/glm-example': model('zai'),
    'deepseek/deepseek-example': model('deepseek'), 'moonshot/kimi-example': model('moonshot'),
    'anthropic/claude-example': model('anthropic'), 'xai/grok-example': model('xai'),
    'dashscope/qwen-example': model('dashscope'), 'minimax/MiniMax-example': model('minimax'),
    'cohere_chat/command-example': model('cohere_chat'), 'ai21/jamba-example': model('ai21'),
    'openai/free-model': model('openai', { mode: 'responses', input_cost_per_token: 0, output_cost_per_token: 0, cache_read_input_token_cost: 0 }),
    'openrouter/openai/gpt-example': model('openrouter'), 'azure/gpt-example': model('azure'),
    'vertex_ai/gemini-example': model('vertex_ai-language-models'), 'mistral/zai-glm-example': model('mistral'),
    'dashscope/deepseek-example': model('dashscope'), 'ft-bad-rate': model('openai', { input_cost_per_token: -1 }),
    'missing-provider': model(undefined), 'embedding': model('openai', { mode: 'embedding' }),
    'missing-mode': model('openai', { mode: undefined }) };
  const result = await getPricing({ env, force: true, fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => data }; } });
  assert.deepEqual(calls, [LITELLM_URL]);
  assert.equal(result.records.length, 13);
  assert.equal(result.priceFor('free-model').cacheRead, 0);
  assert.equal(result.priceFor('google/gemini-example').provider, 'google');
  for (const name of ['missing-provider', 'embedding', 'missing-mode', 'azure/gpt-example', 'mistral/zai-glm-example', 'dashscope/deepseek-example']) assert.equal(result.priceFor(name), null, name);
  const cached = await getPricing({ env, offline: true, fetchImpl: async () => { throw new Error('offline must not fetch'); } });
  assert.deepEqual(cached.records, result.records);
  const before = await readFile(path.join(dir, 'cache', 'litellm-pricing.json'), 'utf8');
  const failed = await getPricing({ env, force: true, fetchImpl: async () => ({ ok: true, json: async () => ({ 'proxy/model': model('openrouter') }) }) });
  assert.equal(failed.sources.litellm, 'stale');
  assert.ok(failed.warnings.length);
  assert.deepEqual(failed.records, result.records);
  assert.equal(await readFile(path.join(dir, 'cache', 'litellm-pricing.json'), 'utf8'), before);
});

test('LiteLLM defaults on; disabling excludes estimates from snapshots and imported backups and preserves reported costs', async (t) => {
  const { env, cleanup } = await fixture(t, { 'gpt-example': model('openai') });
  const enabled = await getPricing({ env, offline: true });
  assert.equal(enabled.priceFor('gpt-example').input, 2e-6);
  let db = createUsageDatabase({ env });
  assert.deepEqual(db.priceStatus().selectedSources, DEFAULT_PRICE_SOURCES);
  const estimated = { ...usage, costUsd: 99 }, reported = { ...usage, sessionId: 'reported', costUsd: 7 };
  db.replace({ ...raw(enabled.records, [estimated, reported]), reportedCosts: new WeakSet([reported]) });
  assert.equal(db.read().entries[0].costUsd, 2);
  db.close(); db = createUsageDatabase({ env });
  cleanup.push(() => db.close());
  const bytes = db.exportDatabase();
  db.selectPriceSources([]);
  assert.deepEqual(db.read().entries.map((row) => row.costUsd), [null, 7]);
  assert.equal(readStoredPriceFor(db.file)('gpt-example'), null);
  db.importDatabase(bytes);
  assert.deepEqual(db.priceStatus().selectedSources, []);
  assert.equal(db.read().entries[0].costUsd, null);
  const disabled = await getPricing({ env, fetchImpl: async () => { throw new Error('disabled must not fetch'); } });
  assert.equal(disabled.sources.litellm, 'disabled');
});

test('retired source selections migrate to the first-party catalog while an explicitly empty selection persists', async (t) => {
  const { env } = await fixture(t, {});
  const db = createUsageDatabase({ env }); db.close();
  const sql = new DatabaseSync(path.join(env.TOKSIGHT_CONFIG_DIR, 'usage.sqlite'));
  sql.prepare('INSERT INTO price_preferences (id, sources_json) VALUES (1, ?)').run(JSON.stringify(['openai', 'cursor', 'openrouter-native']));
  sql.close();
  const migrated = createUsageDatabase({ env });
  assert.deepEqual(migrated.priceStatus().selectedSources, ['litellm']);
  migrated.selectPriceSources([]); migrated.close();
  const reopened = createUsageDatabase({ env });
  assert.deepEqual(reopened.priceStatus().selectedSources, []);
  reopened.close();
});

test('setup validates the sole download source and preserves auto-update preference', async (t) => {
  const db = createUsageDatabase({ file: ':memory:' });
  const seen = [];
  const get = createWebDataService(parseArgs([]), { database: db, collect: async () => raw(),
    genericPricing: async ({ selectedSources }) => { seen.push(selectedSources); return { records: [], warnings: [] }; } });
  t.after(() => get.close());
  await get.initialize();
  await get.setup({ selectedSources: ['litellm'], autoUpdate: false });
  assert.deepEqual(seen, [['litellm']]);
  await get.setup({ selectedSources: [], offline: true });
  assert.equal(get.priceStatus().autoUpdate, false);
  assert.deepEqual(get.priceStatus().availableSources, ['litellm']);
  for (const selectedSources of [null, 'litellm', ['google'], ['cursor'], ['litellm', 'litellm']]) {
    await assert.rejects(get.setup({ selectedSources }), { code: 'BAD_SETUP' });
  }
});
