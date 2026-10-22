import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createPriceLookup, priceRecord } from '../src/pricecatalog.js';
import { createUsageDatabase } from '../src/database.js';
import { createWebDataService } from '../src/webservice.js';
import { createWebServer } from '../src/webserver.js';
import { readStoredPriceFor } from '../src/usageimports.js';
import { parseArgs } from '../src/args.js';
import { readProviderBindings, bindProvider } from '../src/providerbindings.js';
import { fmtUnitPrice, priceSourceUrl } from '../web/lib/prices.js';

const sourceUrl = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const usage = (extra = {}) => ({ client: 'codex', sessionId: 'session', model: 'gpt-example', timestamp: Date.parse('2026-10-02T00:00:00Z'), inputTokens: 1e6,
  outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, directory: null, title: null, ...extra });
const rate = (input = 2e-6) => priceRecord({ source: 'litellm', name: 'gpt-example', provider: 'openai', input, output: 10e-6, cacheRead: 0.5e-6, cacheWrite: 0,
  official: { channel: 'openai', url: sourceUrl, reference: true } });
const raw = (entries = [], records = []) => ({ entries, warnings: [], reportedCosts: new WeakSet(entries.filter((e) => e.costUsd != null)),
  pricing: { records, priceFor: createPriceLookup(records), sources: {}, configDir: '/fixture' } });
const mockPricing = (now) => ({ records: [rate()], warnings: [], sourceDetails: {
  litellm: { fetchedAt: new Date(now()).toISOString(), state: 'fresh', url: sourceUrl },
} });

test('price catalog and history API read saved LiteLLM and custom rates without scans or downloads', async (t) => {
  const database = createUsageDatabase({ file: ':memory:' });
  const get = createWebDataService(parseArgs([]), { database,
    collect: async () => { throw new Error('catalog must not scan agents'); },
    genericPricing: async () => { throw new Error('catalog must not download'); },
  });
  const server = createWebServer({ port: 0, outDir: '.', getData: get });
  t.after(() => server.close());
  const { url } = await server.start();
  assert.deepEqual((await (await fetch(url + '/api/prices')).json()).records, []);
  database.replace(raw([]), '2026-10-01T00:00:00Z');
  const userRate = priceRecord({ ...rate(), source: 'user', official: null });
  database.updatePriceCatalog({ records: [rate(), userRate], sources: ['litellm', 'user'], sourceDetails: {} }, '2026-10-01T00:00:00Z');
  database.updatePriceCatalog({ records: [rate(1e-6)], sources: ['litellm'], sourceDetails: {} }, '2026-10-02T00:00:00Z');
  const response = await fetch(url + '/api/prices');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const body = await response.json();
  assert.equal(body.records.length, 2);
  assert.equal(body.status.revisions, 2);
  const current = body.records.find((row) => row.source === 'litellm');
  assert.equal(current.input, 1e-6, 'API retains USD per token; UI converts to USD per million');
  assert.equal(current.provider, 'openai');
  assert.equal(current.revisions, 2);
  assert.equal(current.observedAt, '2026-10-02T00:00:00Z');
  assert.equal(current.cacheReadFallback, false);
  const fallback = body.records.find((row) => row.source === 'user');
  assert.equal(fallback.revisions, 0);
  assert.notEqual(fallback.id, current.id, 'custom and downloaded prices keep separate IDs');
  const history = await (await fetch(url + '/api/prices?' + new URLSearchParams({ key: current.id }))).json();
  assert.deepEqual(history.history.map((row) => row.record.input), [1e-6, 2e-6]);
  const unknown = await fetch(url + '/api/prices?' + new URLSearchParams({ key: "' OR 1=1 --" }));
  assert.equal(unknown.status, 200);
  assert.equal((await unknown.json()).history.length, 0);
  assert.equal((await fetch(url + '/api/prices', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(url + '/api/prices', { method: 'POST' })).status, 405);
  for (const query of ['?unknown=1', '?key=', '?key=a&key=b']) assert.equal((await fetch(url + '/api/prices' + query)).status, 400);
  const forged = await new Promise((resolve, reject) => { const request = http.get(url + '/api/prices', { headers: { host: 'foreign.test' } }, (res) => { res.resume(); resolve(res.statusCode); }); request.on('error', reject); });
  assert.equal(forged, 403);
  assert.equal(database.priceStatus().completed, false, 'browsing does not complete setup');
});

test('price display preserves tiny token rates, free rates and safe source links', () => {
  assert.equal(fmtUnitPrice(0), '$0');
  assert.equal(fmtUnitPrice(0.03e-6), '$0.03');
  assert.equal(fmtUnitPrice(1e-12), '$0.000001');
  assert.equal(fmtUnitPrice(null), '—');
  assert.equal(priceSourceUrl({ official: { url: 'javascript:alert(1)' } }), null);
  assert.equal(priceSourceUrl({ official: { url: 'https://example.test/prices' } }), 'https://example.test/prices');
});

test('LiteLLM revisions retain historical estimates across reopen and offline backup import', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-price-history-'));
  const file = path.join(dir, 'usage.sqlite');
  let target, db = createUsageDatabase({ file });
  t.after(async () => { db.close(); target?.close(); await rm(dir, { recursive: true, force: true }); });
  const reported = usage({ sessionId: 'reported', costUsd: 7 });
  db.replace(raw([usage({ timestamp: Date.parse('2026-09-01T00:00:00Z') }), usage(), reported]));
  const update = (record, time) => db.updatePriceCatalog({ records: [record], sources: ['litellm'], sourceDetails: {
    litellm: { fetchedAt: time, state: 'refreshed', url: sourceUrl },
  } }, time);
  update(rate(), '2026-10-01T00:00:00.000Z');
  update(rate(), '2026-10-01T12:00:00.000Z');
  assert.equal(db.priceStatus().revisions, 1);
  update(rate(1e-6), '2026-10-02T00:00:00.000Z');
  assert.equal(db.priceStatus().revisions, 2);
  assert.deepEqual(db.read().entries.map((e) => e.costUsd), [2, 1, 7]);
  update(rate(9e-6), '2026-09-01T00:00:00.000Z');
  assert.deepEqual(db.read().entries.map((e) => e.costUsd), [2, 1, 7]);
  const bytes = db.exportDatabase();
  db.close(); db = createUsageDatabase({ file });
  assert.deepEqual(db.read().entries.map((e) => e.costUsd), [2, 1, 7]);
  const targetFile = path.join(dir, 'target.sqlite');
  target = createUsageDatabase({ file: targetFile });
  target.importDatabase(bytes);
  assert.equal(target.priceStatus().revisions, 2);
  assert.deepEqual(target.read().entries.map((e) => e.costUsd), [2, 1, 7]);
  const saved = readStoredPriceFor(targetFile);
  assert.equal(saved('gpt-example', 'codex', usage({ timestamp: Date.parse('2026-09-01T00:00:00Z') })).input, 2e-6);
  assert.equal(saved('gpt-example', 'codex', usage()).input, 1e-6);
});

test('first Web setup shares a LiteLLM download and schedules updates without rescanning usage', async (t) => {
  const db = createUsageDatabase({ file: ':memory:' });
  let scans = 0, fetches = 0, tick, clears = 0, time = Date.parse('2026-10-01T00:00:00Z');
  const get = createWebDataService(parseArgs([]), { database: db, now: () => time,
    collect: async (opts) => { assert.equal(opts.offline, true); scans++; return raw([usage()]); },
    genericPricing: async ({ now = Date.now, selectedSources }) => {
      if (!selectedSources.includes('litellm')) return { records: [], warnings: [], sourceDetails: {} };
      fetches++; return mockPricing(now);
    },
    setIntervalImpl: (callback) => { tick = callback; return { unref() {} }; }, clearIntervalImpl: () => clears++,
  });
  t.after(() => get.close());
  await get.initialize();
  assert.equal(fetches, 0); assert.equal(scans, 1); assert.equal(get.priceStatus().completed, false);
  assert.deepEqual(get.priceStatus().availableSources, ['litellm']);
  const [a, b] = await Promise.all([get.setup({}), get.setup({})]);
  assert.equal(fetches, 1); assert.equal(a.completed, true); assert.equal(b.completed, true); assert.ok(tick);
  time += 8 * 86400000; tick(); await get.updatePrices();
  assert.equal(fetches, 2); assert.equal(scans, 1);
  await get.setup({ offline: true, autoUpdate: false });
  assert.equal(get.priceStatus().autoUpdate, false); assert.ok(clears);
  time += 8 * 86400000; await get(); assert.equal(fetches, 2);
  await get.updatePrices(); assert.equal(fetches, 3);
  await assert.rejects(get.setup({ bad: true }), (e) => e.code === 'BAD_SETUP');
});

test('offline setup never downloads and setup endpoints validate method, Host, Origin and JSON', async (t) => {
  const get = createWebDataService(parseArgs(['--offline']), { database: createUsageDatabase({ file: ':memory:' }), collect: async () => raw([]),
    genericPricing: async ({ offline, selectedSources }) => { assert.equal(offline, true); assert.deepEqual(selectedSources, []); return { records: [], warnings: [], sourceDetails: {} }; },
  });
  await get.initialize();
  const server = createWebServer({ port: 0, outDir: '.', getData: get });
  t.after(() => server.close());
  const { url } = await server.start();
  assert.equal((await fetch(url + '/api/prices/status')).status, 200);
  assert.equal((await fetch(url + '/api/setup')).status, 405);
  assert.equal((await fetch(url + '/api/setup', { method: 'POST', headers: { origin: 'https://foreign.test' } })).status, 403);
  const forged = await new Promise((resolve, reject) => { const request = http.get(url + '/api/prices/status', { headers: { host: 'foreign.test' } }, (response) => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); });
  assert.equal(forged, 403);
  for (const body of ['bad json', '{"autoUpdate":"yes"}', '{"selectedSources":["openai"]}']) {
    assert.equal((await fetch(url + '/api/setup', { method: 'POST', body })).status, 400);
  }
  const response = await fetch(url + '/api/setup', { method: 'POST', body: '{"offline":true}' });
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.completed, true); assert.equal(body.offline, true);
  await assert.rejects(get.updatePrices(), (e) => e.code === 'PRICE_OFFLINE');
});

test('continuing locally defers downloads and provider bindings follow their time intervals', async (t) => {
  let downloads = 0;
  const get = createWebDataService(parseArgs([]), { database: createUsageDatabase({ file: ':memory:' }), collect: async () => raw([]),
    genericPricing: async ({ offline }) => { if (!offline) downloads++; return { records: [], sourceDetails: {}, warnings: [] }; },
  });
  t.after(() => get.close());
  await get.initialize(); await get.setup({ offline: true }); await get(); assert.equal(downloads, 0);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-bindings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'providers.json'), JSON.stringify([
    { client: 'codex', providerId: 'myproxy', provider: 'openai', until: '2026-10-02T00:00:00Z' },
    { client: 'codex', providerId: 'myproxy', provider: 'deepseek', since: '2026-10-02T00:00:00Z' },
  ]));
  const rows = readProviderBindings({ env: { TOKSIGHT_CONFIG_DIR: dir } });
  const old = bindProvider(usage({ providerId: 'myproxy', timestamp: Date.parse('2026-10-01T00:00:00Z') }), rows);
  const current = bindProvider(usage({ providerId: 'myproxy' }), rows);
  assert.equal(old.pricingProvider, 'openai'); assert.equal(current.pricingProvider, 'deepseek');
  assert.equal(bindProvider(current, []).pricingProvider, undefined);
  assert.equal(createPriceLookup([rate()])('gpt-example', 'codex', old).input, 2e-6);
  assert.equal(createPriceLookup([rate()])('gpt-example', 'codex', usage({ providerId: 'myproxy' })), null);
  assert.equal(bindProvider(old, [rows[0], rows[0]]).pricingProvider, undefined, 'ambiguous bindings remain unknown');
});
