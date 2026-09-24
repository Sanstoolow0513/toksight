import test from 'node:test';
import assert from 'node:assert/strict';

import { createPriceLookup, modelIdentity, priceRecord, reportModelName } from '../src/pricecatalog.js';
import { createUsageDatabase } from '../src/database.js';
import { buildCostCoverage } from '../src/costcoverage.js';

const rate = (name, input, scope = 'cursor', source = 'cursor') => priceRecord({
  name, scope, source, input: input / 1e6, cacheRead: input / 1e6,
  cacheWrite: input / 1e6, output: input / 1e6,
});

test('one model identity keeps Cursor effort separate from priced variants and isolates Cursor rates', () => {
  assert.deepEqual(modelIdentity('cursor-grok-4.6-xhigh-fast', 'cursor'), { id: 'grok-4.6-fast', effort: 'xhigh' });
  assert.deepEqual(modelIdentity('cursor-grok-4.6-high', 'cursor'), { id: 'grok-4.6', effort: 'high' });
  assert.deepEqual(modelIdentity('claude-4.6-opus-high-thinking', 'cursor'), { id: 'claude:4.6-opus', effort: 'high' });
  assert.deepEqual(modelIdentity('opus5.5-high', 'cursor'), { id: 'claude:5.5-opus', effort: 'high' });
  assert.deepEqual(modelIdentity('claude-opus5.5-medium-thinking', 'cursor'), { id: 'claude:5.5-opus', effort: 'medium' });
  assert.deepEqual(modelIdentity('cursor-grok-4.7-500k-fast', 'cursor'), { id: 'grok-4.7-500k-fast', effort: null });
  const lookup = createPriceLookup([
    rate('Grok 4.6', 2), rate('Grok 4.6 (Fast)', 4),
    rate('Claude Opus 5.5', 4),
    rate('grok-4.6', 9, 'default', 'litellm'),
  ]);
  assert.equal(lookup('cursor-grok-4.6-xhigh-fast', 'cursor').input, 4e-6);
  assert.equal(lookup('cursor-grok-4.6-high', 'cursor').input, 2e-6);
  assert.equal(lookup('opus5.5-high', 'cursor').input, 4e-6);
  assert.equal(lookup('grok-4.6', 'claude').input, 9e-6);
  assert.equal(lookup('auto', 'cursor'), null);
  assert.equal(lookup('cursor-grok-4.6-max', 'cursor'), null);
  assert.equal(lookup('composer-2-fast', 'cursor'), null);
  assert.equal(reportModelName('opus5.5-high', 'cursor'), 'Claude Opus 5.5');
  assert.equal(reportModelName('claude-opus-5-5', 'claude'), 'Claude Opus 5.5');
  assert.equal(reportModelName('anthropic/claude-opus-5-5-20260801', 'claude'), 'Claude Opus 5.5');
  assert.equal(reportModelName('gpt-5.6-sol', 'codex'), 'GPT-5.6 Sol');
  assert.equal(reportModelName('cursor-grok-4.7-500k-fast', 'cursor'), 'Grok 4.7 500k (Fast)');
});

test('price catalog updates reprice estimates without changing reported charges or usage rows', () => {
  const db = createUsageDatabase({ file: ':memory:' });
  try {
    const cursor = { client: 'cursor', model: 'cursor-grok-4.6-xhigh', sessionId: null, timestamp: 1,
      inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      reasoningTokens: 0, costUsd: null, directory: null, title: null };
    const generic = { ...cursor, client: 'codex', model: 'grok-4.6', costUsd: 8 };
    const reported = { ...cursor, client: 'opencode', model: 'grok-4.6', costUsd: 7 };
    const old = [rate('Grok 4.6', 2), rate('grok-4.6', 8, 'default', 'litellm')];
    const oldLookup = createPriceLookup(old);
    db.replace({ entries: [generic, reported], warnings: [], reportedCosts: new WeakSet([reported]),
      pricing: { priceFor: oldLookup, records: old, sources: { cursor: 'fresh', litellm: 'fresh' }, configDir: '/fixture' } });
    db.importCursor([{ key: 'cursor-event', entry: cursor, included: true }]);
    assert.equal(db.read().entries.find((entry) => entry.client === 'cursor').costUsd, 2);
    assert.equal(db.read().entries.find((entry) => entry.client === 'codex').costUsd, 8);
    const updated = [rate('Grok 4.6', 3), rate('grok-4.6', 9, 'default', 'litellm')];
    db.updatePriceCatalog({ records: updated, sources: ['cursor', 'litellm'], sourceDetails: {
      cursor: { fetchedAt: '2026-09-24T00:00:00.000Z', state: 'refreshed', url: 'https://cursor.com' },
      litellm: { fetchedAt: '2026-09-24T00:00:00.000Z', state: 'refreshed', url: 'https://github.com' },
    } });
    const rows = db.read().entries;
    assert.equal(rows.find((entry) => entry.client === 'cursor').costUsd, 3);
    assert.equal(rows.find((entry) => entry.client === 'codex').costUsd, 9);
    assert.equal(rows.find((entry) => entry.client === 'opencode').costUsd, 7);
    assert.equal(db.read().pricing.catalog.length, 2);
    assert.equal(db.read().pricing.updates.cursor.fetchedAt, '2026-09-24T00:00:00.000Z');
    assert.equal(buildCostCoverage(rows, db.read()).sources.cursor.requests, 1);
    assert.equal(buildCostCoverage(rows, db.read()).sources.reported.requests, 1);
    db.updatePriceCatalog({ records: old, sources: ['cursor', 'litellm'], sourceDetails: {
      cursor: { fetchedAt: '2026-09-23T00:00:00.000Z', state: 'stale', url: null },
      litellm: { fetchedAt: '2026-09-23T00:00:00.000Z', state: 'stale', url: null },
    } });
    assert.equal(db.read().entries.find((entry) => entry.client === 'cursor').costUsd, 3);
    assert.equal(db.read().entries.find((entry) => entry.client === 'codex').costUsd, 9);
  } finally { db.close(); }
});
