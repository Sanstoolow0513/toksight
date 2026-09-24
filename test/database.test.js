import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createUsageDatabase, databasePath } from '../src/database.js';
import { buildCostCoverage } from '../src/costcoverage.js';
import { parseCursorCsv } from '../src/cursorcsv.js';

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
      sources: { builtin: true, litellm: 'skipped (offline)', user: false },
      configDir: '/fixture',
      priceFor: (model) => model === 'priced' ? { source: 'builtin', cacheReadFallback: true } : null,
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
  assert.equal(coverage.sources.builtin.requests, 1);
  assert.equal(coverage.cacheFallbackRequests, 1);

  writer.replace(collected([entry('new', 9)]), '2026-09-08T13:00:00.000Z');
  const second = reader.read();
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0].model, 'new');
  assert.equal(second.refreshedAt, '2026-09-08T13:00:00.000Z');

  const csv = 'Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n' +
    '2026-08-31T12:00:00Z,,,Included,cursor-test,No,0,10,30,2,42,Included\n';
  const imports = parseCursorCsv(csv).records;
  assert.equal(writer.importCursor(imports, '2026-09-08T14:00:00.000Z').imported, 1);
  assert.equal(reader.read().entries.length, 2);
  assert.equal(reader.read().refreshedAt, '2026-09-08T14:00:00.000Z');
  writer.updateCursorPricing({
    state: 'fresh',
    priceFor: () => ({ input: 1e-6, cacheRead: 0.1e-6, cacheWrite: 1e-6, output: 2e-6, source: 'cursor' }),
  });
  assert.ok(Math.abs(reader.read().entries[1].costUsd - 17e-6) < 1e-12);
  assert.equal(writer.importCursor(imports).duplicates, 1);
  writer.replace(collected([entry('after-import', 3)]), '2026-09-08T15:00:00.000Z');
  assert.deepEqual(reader.read().entries.map((e) => e.model), ['after-import', 'cursor-test']);
  assert.ok(Math.abs(reader.read().entries[1].costUsd - 17e-6) < 1e-12);
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

test('legacy all-column Cursor keys are reconciled on read without changing stored rows', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-cursor-legacy-'));
  const file = path.join(dir, 'usage.sqlite');
  const db = createUsageDatabase({ file });
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  db.replace(collected([]));
  const csv = 'Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n' +
    '2026-08-31T12:00:00Z,,,Included,cursor-test,No,0,10,30,2,42,Included\n';
  const parsed = parseCursorCsv(csv).records[0];
  const other = new DatabaseSync(file);
  try {
    const insert = other.prepare('INSERT INTO cursor_imports (fingerprint, data_json, reported_cost) VALUES (?, ?, ?)');
    insert.run('old-included:0', JSON.stringify(parsed.entry), 0);
    insert.run('old-charged:0', JSON.stringify({ ...parsed.entry, costUsd: 0.4 }), 1);
  } finally { other.close(); }
  assert.equal(db.read().entries.length, 1);
  assert.equal(db.read().entries[0].costUsd, 0.4);
  assert.equal(db.importCursor([{ ...parsed, entry: { ...parsed.entry, costUsd: 0.4 } }]).duplicates, 1);
  assert.equal(db.read().entries.length, 1);
  const corrected = db.importCursor([{ ...parsed, entry: { ...parsed.entry, costUsd: 0.5 } }]);
  assert.equal(corrected.updated, 1);
  assert.equal(db.read().entries.length, 1);
  assert.equal(db.read().entries[0].costUsd, 0.5);
});

test('legacy Cursor imports gain an Included marker and can use official rates after migration', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-cursor-migration-'));
  const file = path.join(dir, 'usage.sqlite');
  const csv = 'Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n' +
    '2026-08-31T12:00:00Z,,,Included,gpt-5,No,0,10,30,2,42,Included\n';
  const record = parseCursorCsv(csv).records[0];
  const old = new DatabaseSync(file);
  try {
    old.exec('CREATE TABLE cursor_imports (fingerprint TEXT PRIMARY KEY, data_json TEXT NOT NULL, reported_cost INTEGER NOT NULL CHECK (reported_cost IN (0, 1)))');
    old.prepare('INSERT INTO cursor_imports (fingerprint, data_json, reported_cost) VALUES (?, ?, 0)')
      .run(record.key, JSON.stringify(record.entry));
  } finally { old.close(); }
  const db = createUsageDatabase({ file });
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  db.replace({
    entries: [record.entry], warnings: [], reportedCosts: new WeakSet(),
    pricing: {
      sources: { cursor: 'fresh' }, configDir: dir,
      priceFor: (_model, client) => client === 'cursor' ? {
        input: 1e-6, output: 2e-6, cacheRead: 0.1e-6, cacheWrite: 1e-6, source: 'cursor',
      } : null,
    },
  });
  assert.ok(Math.abs(db.read().entries[0].costUsd - 17e-6) < 1e-12);
  assert.equal(buildCostCoverage(db.read().entries, db.read()).sources.cursor.requests, 1);
});
