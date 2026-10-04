import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getPricing } from '../src/pricing.js';
import { DEFAULT_PRICE_SOURCES } from '../src/priceselection.js';
import { getPublicPricing, parseNativeRouterPrices, PUBLIC_PRICE_SOURCES } from '../src/publicpricing.js';
import { createPriceLookup, priceRecord } from '../src/pricecatalog.js';
import { createUsageDatabase } from '../src/database.js';
import { readStoredPriceFor } from '../src/usageimports.js';
import { createWebDataService } from '../src/webservice.js';
import { parseArgs } from '../src/args.js';

const pricing = { prompt: '0.000002', completion: '0.000004', input_cache_read: '0.0000002' };
const endpoint = (provider_name = 'Alibaba', tag = 'alibaba', rates = pricing) => ({ provider_name, tag, pricing: rates });
const body = (...endpoints) => ({ data: { endpoints } });
const model = 'qwen/qwen3-example';
const usage = { client: 'opencode', model, sessionId: 'session', timestamp: Date.parse('2026-10-02T00:00:00Z'),
  inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd: null, directory: null, title: null };
const raw = (records = [], entries = [usage]) => ({ entries, warnings: [], reportedCosts: new WeakSet(),
  pricing: { records, priceFor: createPriceLookup(records), sources: {}, configDir: '/fixture' } });

test('native references verify author and endpoint operator, retain provenance and reject conflicting endpoint prices', () => {
  const rows = parseNativeRouterPrices(body(endpoint(), endpoint('Third party', 'proxy', { prompt: '0', completion: '0' })), model);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'openrouter-native');
  assert.equal(rows[0].provider, 'alibaba');
  assert.equal(rows[0].input, 2e-6);
  assert.deepEqual(rows[0].official.routerEndpoints, ['alibaba']);
  assert.match(rows[0].official.url, /openrouter.ai.*endpoints$/);
  assert.deepEqual(parseNativeRouterPrices(body(endpoint('Alibaba', 'proxy')), model), []);
  assert.deepEqual(parseNativeRouterPrices(body(endpoint('Third party', 'alibaba')), model), []);
  assert.deepEqual(parseNativeRouterPrices(body(endpoint()), 'other/model'), []);
  assert.deepEqual(parseNativeRouterPrices(body(), model), []);
  assert.equal(parseNativeRouterPrices(body(endpoint(), endpoint('Alibaba', 'alibaba/eu')), model).length, 1);
  assert.throws(() => parseNativeRouterPrices(body(endpoint(), endpoint('Alibaba', 'alibaba/fast', { ...pricing, prompt: '0.000003' })), model), /ambiguous/);
  const lookup = createPriceLookup(rows);
  assert.equal(lookup(model, 'opencode', { ...usage, providerId: 'alibaba' }).input, 2e-6);
  assert.equal(lookup(model, 'opencode', { ...usage, providerId: 'qwen' }).input, 2e-6);
  assert.equal(lookup('qwen3-example').input, 2e-6);
  assert.equal(lookup(model, 'opencode', { ...usage, providerId: 'proxy' }), null);
  assert.equal(lookup(model, 'opencode', { ...usage, providerId: 'openrouter' }), null);
  const other = parseNativeRouterPrices(body(endpoint('DeepSeek', 'deepseek')), 'deepseek/qwen3-example');
  assert.equal(createPriceLookup([...rows, ...other])('qwen3-example'), null, 'ambiguous bare names across authors do not depend on download order');
  assert.equal(createPriceLookup([...rows, ...other])(model).provider, 'alibaba');
});

test('official website and user prices beat OpenRouter native references across multiple vendors', () => {
  const router = parseNativeRouterPrices(body(endpoint('OpenAI', 'openai')), 'openai/gpt-example')[0];
  const google = parseNativeRouterPrices(body(endpoint('Google AI Studio', 'google-ai-studio')), 'google/gemini-example')[0];
  const direct = priceRecord({ ...router, source: 'openai', name: 'gpt-example', input: 3e-6, official: { channel: 'openai' } });
  const lookup = createPriceLookup([router, google, direct]);
  assert.equal(lookup('gpt-example').input, 3e-6);
  assert.equal(lookup('gemini-example', 'opencode', { providerId: 'google' }).input, 2e-6);
  const user = priceRecord({ ...direct, source: 'user', official: null, input: 5e-6 });
  assert.equal(createPriceLookup([router, direct, user])('gpt-example').input, 5e-6);
});

test('selected downloads can be Google-only; native discovery skips third-party-only models and never uses model-level pricing', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === PUBLIC_PRICE_SOURCES.openrouter) return { ok: true, text: async () => JSON.stringify({ data: [
      { id: model },
      { id: 'deepseek/example', pricing }, { id: 'unknown/example', pricing },
    ] }) };
    return { ok: true, text: async () => JSON.stringify(url.includes('qwen/') ? body(endpoint()) : body(endpoint('Proxy', 'proxy'))) };
  };
  const result = await getPublicPricing({ selectedSources: ['openrouter-native'], fetchImpl });
  assert.equal(calls.length, 3);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].input, 2e-6);
  assert.deepEqual(result.sources, ['openrouter-native']);
  calls.length = 0;
  await getPublicPricing({ selectedSources: ['google'], fetchImpl });
  assert.deepEqual(calls, [PUBLIC_PRICE_SOURCES.google]);
  calls.length = 0;
  await getPublicPricing({ selectedSources: [], fetchImpl });
  await getPublicPricing({ offline: true, fetchImpl });
  assert.deepEqual(calls, []);
});

test('LiteLLM defaults off even with disk cache; opt-in persists, disabling excludes snapshots and imported backups', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-source-choice-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { TOKSIGHT_CONFIG_DIR: dir };
  await mkdir(path.join(dir, 'cache'));
  await writeFile(path.join(dir, 'cache', 'litellm-pricing.json'), JSON.stringify({ fetchedAt: Date.now(), data: {
    'legacy-example': { input_cost_per_token: 2e-6, output_cost_per_token: 4e-6 },
  } }));
  const noFetch = async () => { throw new Error('must not fetch'); };
  const disabled = await getPricing({ env, fetchImpl: noFetch });
  assert.equal(disabled.sources.litellm, 'disabled');
  assert.equal(disabled.priceFor('legacy-example'), null);
  let db = createUsageDatabase({ env });
  assert.deepEqual(db.priceStatus().selectedSources, DEFAULT_PRICE_SOURCES);
  db.selectPriceSources(['litellm']);
  const enabled = await getPricing({ env, offline: true });
  assert.equal(enabled.priceFor('legacy-example').input, 2e-6);
  const estimated = { ...usage, model: 'legacy-example', costUsd: 99 };
  const reported = { ...estimated, sessionId: 'reported', costUsd: 7 };
  db.replace({ ...raw(enabled.records, [estimated, reported]), reportedCosts: new WeakSet([reported]) });
  assert.equal(db.read().entries[0].costUsd, 2);
  db.close(); db = createUsageDatabase({ env });
  const bytes = db.exportDatabase();
  db.selectPriceSources([]);
  assert.deepEqual(db.read().entries.map((row) => row.costUsd), [null, 7]);
  assert.equal(db.priceCatalog().records.some((row) => row.source === 'litellm'), false);
  assert.equal(readStoredPriceFor(db.file)('legacy-example'), null);
  db.importDatabase(bytes);
  assert.deepEqual(db.priceStatus().selectedSources, []);
  assert.equal(db.read().entries[0].costUsd, null);
  db.close();
});

test('source changes filter historical prices, survive reopen and backups preserve native metadata', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-native-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'db.sqlite');
  let db = createUsageDatabase({ file });
  const record = parseNativeRouterPrices(body(endpoint()), model)[0];
  db.replace(raw());
  db.updatePriceCatalog({ records: [record], sources: ['openrouter-native'] }, '2026-10-01T00:00:00.000Z');
  assert.equal(db.read().entries[0].costUsd, 2);
  const backup = db.exportDatabase();
  db.selectPriceSources(['google']);
  assert.equal(db.read().entries[0].costUsd, null);
  assert.equal(readStoredPriceFor(file)(model, 'opencode', usage), null);
  db.close(); db = createUsageDatabase({ file });
  assert.deepEqual(db.priceStatus().selectedSources, ['google']);
  db.importDatabase(backup);
  assert.equal(db.read().entries[0].costUsd, null);
  db.selectPriceSources(['openrouter-native']);
  assert.equal(db.read().entries[0].costUsd, 2);
  assert.equal(db.priceCatalog().records[0].official.providerName, 'Alibaba');
  db.close();
});

test('setup validates selections, passes them to downloaders and preserves auto-update preference', async (t) => {
  const db = createUsageDatabase({ file: ':memory:' });
  const seen = [];
  const get = createWebDataService(parseArgs([]), { database: db, collect: async () => raw(),
    genericPricing: async ({ selectedSources }) => { seen.push(selectedSources); return { records: [], warnings: [] }; },
    publicPricing: async ({ selectedSources }) => { seen.push(selectedSources); return { records: [], sources: [], warnings: [], sourceDetails: {} }; },
    cursorPricing: async () => { throw new Error('disabled Cursor must not fetch'); } });
  t.after(() => get.close());
  await get.initialize();
  await get.setup({ selectedSources: ['google'], autoUpdate: false });
  assert.deepEqual(seen, [['google'], ['google']]);
  await get.setup({ selectedSources: [], offline: true });
  assert.equal(get.priceStatus().autoUpdate, false);
  for (const selectedSources of [null, 'google', ['unknown'], ['google', 'google']]) {
    await assert.rejects(get.setup({ selectedSources }), { code: 'BAD_SETUP' });
  }
});
