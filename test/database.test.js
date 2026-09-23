import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createUsageDatabase, databasePath } from '../src/database.js';
import { buildCostCoverage } from '../src/costcoverage.js';

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
