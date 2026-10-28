import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createUsageDatabase, databasePath } from '../src/database.js';
import { buildCostCoverage } from '../src/costcoverage.js';
import { priceRecord } from '../src/pricecatalog.js';
import { historyPriceKey } from '../src/pricehistory.js';

const entry = (model, costUsd) => ({
  client: 'opencode', sessionId: 'one', model, timestamp: Date.now(),
  inputTokens: 100, outputTokens: 20, reasoningTokens: 0,
  cacheReadTokens: 5, cacheWriteTokens: 0, costUsd,
  directory: 'C:\\fixture', title: 'Example',
});

function collected(entries) {
  return {
    entries, warnings: ['fixture warning'], reportedCosts: new WeakSet(entries.slice(0, 1)),
    pricing: {
      sources: { user: true, litellm: 'skipped (offline)' },
      configDir: '/fixture',
      priceFor: (model) => model === 'priced' ? { source: 'user', cacheReadFallback: true } : null,
    },
  };
}

test('SQLite snapshot survives reopen, retains cost provenance, and notices external refreshes', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-db-'));
  const file = path.join(dir, 'usage.sqlite');
  assert.equal(databasePath({ env: { TOKSIGHT_CONFIG_DIR: dir }, home: dir }), file);
  const writer = createUsageDatabase({ file });
  const reader = createUsageDatabase({ file });
  t.after(async () => { reader.close(); writer.close(); await rm(dir, { recursive: true, force: true }); });
  assert.equal(reader.read(), null);

  writer.replace(collected([entry('priced', 4), entry('priced', 1)]), '2026-09-08T12:00:00.000Z');
  const first = reader.read();
  assert.equal(first.refreshedAt, '2026-09-08T12:00:00.000Z');
  assert.equal(first.entries.length, 2);
  assert.equal(first.entries[0].directory, 'C:\\fixture');
  assert.deepEqual(first.warnings, ['fixture warning']);
  const coverage = buildCostCoverage(first.entries, first);
  assert.equal(coverage.sources.reported.requests, 1);
  assert.equal(coverage.sources.user.requests, 1);
  assert.equal(coverage.cacheFallbackRequests, 1);

  writer.replace(collected([entry('new', 9)]), '2026-09-08T13:00:00.000Z');
  const second = reader.read();
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0].model, 'new');
  assert.equal(second.refreshedAt, '2026-09-08T13:00:00.000Z');


});

test('failed SQLite replacement rolls back rows and metadata', () => {
  const db = createUsageDatabase({ file: ':memory:' });
  try {
    db.replace(collected([entry('priced', 4)]), '2026-09-08T12:00:00.000Z');
    const broken = { ...entry('bad', 2), client: null };
    assert.throws(() => db.replace(collected([entry('new', 1), broken]), '2026-09-08T13:00:00.000Z'));
    const old = db.read();
    assert.equal(old.entries.length, 1);
    assert.equal(old.entries[0].model, 'priced');
    assert.equal(old.refreshedAt, '2026-09-08T12:00:00.000Z');
  } finally { db.close(); }
});

test('legacy Cursor tables remain untouched and are excluded from reports and new databases', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-retired-cursor-'));
  const file = path.join(dir, 'usage.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec('CREATE TABLE cursor_imports (fingerprint TEXT PRIMARY KEY, data_json TEXT NOT NULL, reported_cost INTEGER NOT NULL)');
  legacy.prepare('INSERT INTO cursor_imports VALUES (?, ?, ?)').run('legacy:0', '{"old":true}', 0);
  legacy.close();
  const db = createUsageDatabase({ file });
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  db.replace(collected([entry('priced', 4), { ...entry('cursor-old', 1), client: 'cursor' }]));
  assert.deepEqual(db.read().entries.map(e => e.client), ['opencode']);
  assert.equal(db.importCursor, undefined);
  assert.equal(db.updateCursorPricing, undefined);
  const inspect = new DatabaseSync(file);
  try {
    assert.deepEqual(inspect.prepare('PRAGMA table_info(cursor_imports)').all().map(c => c.name), ['fingerprint', 'data_json', 'reported_cost']);
    assert.equal(inspect.prepare('SELECT data_json FROM cursor_imports').get().data_json, '{"old":true}');
  } finally { inspect.close(); }
  const freshFile = path.join(dir, 'fresh.sqlite');
  createUsageDatabase({ file: freshFile }).close();
  const fresh = new DatabaseSync(freshFile);
  try { assert.equal(fresh.prepare("SELECT name FROM sqlite_master WHERE name = 'cursor_imports'").get(), undefined); }
  finally { fresh.close(); }
});

test('first-party LiteLLM observations retain rate history and source selection controls every history view', () => {
  const db = createUsageDatabase({ file: ':memory:' });
  const rate = (input) => priceRecord({ source: 'litellm', provider: 'openai', name: 'gpt-example', input, output: 0, cacheRead: 0, cacheWrite: 0 });
  try {
    db.replace(collected([entry('gpt-example', null)]));
    const first = '2026-09-08T12:00:00.000Z', second = '2026-09-09T12:00:00.000Z';
    db.updatePriceCatalog({ records: [rate(1e-6)], sources: ['litellm'], sourceDetails: {} }, first);
    db.updatePriceCatalog({ records: [rate(2e-6)], sources: ['litellm'], sourceDetails: {} }, second);
    const key = historyPriceKey(rate(1e-6));
    assert.equal(db.priceStatus().revisions, 2);
    assert.deepEqual(db.priceCatalog(key).history.map(r => r.observedAt), [second, first]);
    assert.equal(db.priceCatalog().records[0].revisions, 2);
    assert.equal(db.read().pricing.priceFor('gpt-example', 'codex', { timestamp: Date.parse(first) }).input, 1e-6);
    db.selectPriceSources([]);
    assert.equal(db.priceStatus().revisions, 0);
    assert.deepEqual(db.priceCatalog(key).history, []);
    assert.deepEqual(db.priceCatalog().records, []);
    assert.equal(db.read().pricing.priceFor('gpt-example', 'codex'), null);
    db.selectPriceSources(['litellm']);
    assert.equal(db.priceStatus().revisions, 2);
  } finally { db.close(); }
});
