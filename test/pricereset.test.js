import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createUsageDatabase } from '../src/database.js';
import { createPriceLookup, priceRecord } from '../src/pricecatalog.js';
import { parseArgs } from '../src/args.js';
import { createWebDataService } from '../src/webservice.js';
import { createWebServer } from '../src/webserver.js';
import { resetPriceDatabase } from '../src/pricereset.js';

const rate = (input = 2e-6) => priceRecord({ source: 'litellm', provider: 'openai', name: 'gpt-example', input,
  output: 0, cacheRead: 0, cacheWrite: 0 });
const entry = (sessionId, costUsd = null) => ({ client: 'codex', sessionId, model: 'gpt-example',
  timestamp: Date.parse('2026-10-01T12:00:00Z'), inputTokens: 1e6, outputTokens: 0,
  cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costUsd, directory: null, title: null });
const raw = (entries) => ({ entries, warnings: [], reportedCosts: new WeakSet(entries.filter(e => e.costUsd != null)),
  pricing: { records: [rate()], sources: {}, configDir: '/fixture', priceFor: createPriceLookup([rate()]) } });

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-price-reset-'));
  const env = { TOKSIGHT_CONFIG_DIR: dir };
  const db = createUsageDatabase({ env });
  const connections = [db];
  t.after(async () => { for (const connection of connections) connection.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, env, db, connections };
}

test('reset removes price history and every fallback, preserves imports and charges across reopen and backup', async (t) => {
  const { db, env, connections } = await fixture(t);
  const source = createUsageDatabase({ file: ':memory:' });
  source.replace(raw([entry('imported'), entry('charged', 7)]));
  db.replace(raw([entry('local')]));
  db.importDatabase(source.exportDatabase());
  source.close();
  db.selectPriceSources(['litellm']);
  db.completeSetup({ autoUpdate: false });
  const reader = createUsageDatabase({ env });
  connections.push(reader);
  assert.equal(reader.read().entries.find(e => e.sessionId === 'local').costUsd, 2);
  const before = db.read();
  const status = resetPriceDatabase(db, { env });
  assert.equal(status.completed, false);
  assert.equal(status.revisions, 0);
  assert.deepEqual(status.selectedSources, ['litellm']);
  assert.deepEqual(db.priceCatalog().records, []);
  assert.deepEqual(db.priceCatalog().updates, {});
  const after = reader.read();
  assert.equal(after.entries.length, 3);
  assert.equal(after.refreshedAt, before.refreshedAt);
  assert.deepEqual(after.entries.map(e => e.costUsd), [null, null, 7]);
  assert.equal(after.reportedCosts.has(after.entries[2]), true);
  const reopened = createUsageDatabase({ env });
  const restored = createUsageDatabase({ file: ':memory:' });
  try {
    assert.deepEqual(reopened.read().entries.map(e => e.costUsd), [null, null, 7]);
    restored.importDatabase(db.exportDatabase());
    assert.deepEqual(restored.read().entries.map(e => e.costUsd), [null, null, 7]);
    db.updatePriceCatalog({ records: [rate(3e-6)], sources: ['litellm'], sourceDetails: {} });
    assert.deepEqual(db.read().entries.map(e => e.costUsd), [3, 3, 7]);
    assert.equal(db.priceStatus().revisions, 1);
  } finally { reopened.close(); restored.close(); }
});

test('reset rolls back all SQLite changes on failure', async (t) => {
  const { db } = await fixture(t);
  db.replace(raw([entry('local')]));
  db.completeSetup();
  const connection = new DatabaseSync(db.file);
  connection.exec("CREATE TRIGGER fail_reset BEFORE DELETE ON price_history BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  connection.close();
  assert.throws(() => db.resetPrices(), /fixture failure/);
  assert.equal(db.priceStatus().completed, true);
  assert.equal(db.priceStatus().revisions, 1);
  assert.equal(db.read().entries[0].costUsd, 2);
  assert.equal(db.priceCatalog().records.length, 1);
});

test('CLI reset removes only downloaded caches and rejects usage filters', async (t) => {
  const { db, dir, env } = await fixture(t);
  db.replace(raw([entry('local')]));
  await mkdir(path.join(dir, 'cache'));
  for (const name of ['litellm-pricing.json', 'cursor-pricing.json', 'unrelated.json']) {
    await writeFile(path.join(dir, 'cache', name), '{}');
  }
  await writeFile(path.join(dir, 'pricing.json'), '{}');
  await writeFile(path.join(dir, 'providers.json'), '[]');
  const cli = fileURLToPath(new URL('../bin/toksight.js', import.meta.url));
  const result = await promisify(execFile)(process.execPath, [cli, 'reset-prices', '--offline', '--json'], { env: { ...process.env, ...env } });
  assert.equal(JSON.parse(result.stdout).completed, false);
  assert.equal(db.read().entries.length, 1);
  for (const name of ['litellm-pricing.json', 'cursor-pricing.json']) {
    await assert.rejects(readFile(path.join(dir, 'cache', name)), { code: 'ENOENT' });
  }
  assert.equal(await readFile(path.join(dir, 'pricing.json'), 'utf8'), '{}');
  assert.equal(await readFile(path.join(dir, 'providers.json'), 'utf8'), '[]');
  assert.equal(await readFile(path.join(dir, 'cache', 'unrelated.json'), 'utf8'), '{}');
  assert.throws(() => parseArgs(['reset-prices', '--today']), /filters are not supported/);
  assert.throws(() => parseArgs(['reset-prices', '--client', 'codex']), /filters are not supported/);
  resetPriceDatabase(db, { env }); // Repeated resets and missing caches are harmless.
});

test('Web reset validates Host, Origin and method, blocks active updates, then rebuilds without scanning', async (t) => {
  const { db, env } = await fixture(t);
  db.replace(raw([entry('local')]));
  db.selectPriceSources(['litellm']);
  db.completeSetup({ autoUpdate: false });
  let release, fetches = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const get = createWebDataService(parseArgs([]), { database: db, env,
    collect: async () => { throw new Error('must not scan'); },
    genericPricing: async () => { fetches++; await pending; return { records: [rate(3e-6)], sourceDetails: {}, warnings: [] }; },
  });
  const server = createWebServer({ port: 0, outDir: '.', getData: get });
  t.after(() => server.close());
  const { url } = await server.start();
  const endpoint = url + '/api/prices/reset';
  assert.equal((await fetch(endpoint)).status, 405);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { origin: 'https://foreign.test' } })).status, 403);
  const forged = await new Promise((resolve, reject) => {
    const request = http.request(endpoint, { method: 'POST', headers: { host: 'foreign.test' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(forged, 403);
  const update = get.updatePrices();
  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 409);
  release(); await update;
  const response = await fetch(endpoint, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, false);
  assert.equal(fetches, 1);
  assert.equal(db.priceStatus().revisions, 0);
  await get.setup({ autoUpdate: false });
  assert.equal(fetches, 2);
  assert.equal(db.priceStatus().completed, true);
  assert.equal(db.priceStatus().revisions, 1);
  assert.equal(db.read().entries[0].costUsd, 3);
});

test('offline reset and local setup rebuild custom rates without network or collection', async (t) => {
  const { db, dir, env } = await fixture(t);
  db.replace(raw([entry('local'), entry('reported', 7)]));
  await writeFile(path.join(dir, 'pricing.json'), JSON.stringify({ 'gpt-example': { input: 4, output: 0 } }));
  const get = createWebDataService(parseArgs(['--offline']), { database: db, env,
    collect: async () => { throw new Error('must not scan'); },
  });
  t.after(() => get.close());
  get.resetPrices();
  await get.setup({ offline: true });
  assert.deepEqual(db.read().entries.map(e => e.costUsd), [4, 7]);
  assert.equal(db.priceStatus().revisions, 0);
  assert.equal(db.priceStatus().completed, true);
});
