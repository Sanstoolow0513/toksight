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
  const lookup = createPriceLookup([
    rate('Grok 4.6', 2), rate('Grok 4.6 (Fast)', 4),
    rate('Claude Opus 5.5', 4), rate('Claude Opus 4.6', 5), rate('Grok 4.7 500k (Fast)', 6),
    rate('grok-4.6', 9, 'default', 'litellm'),
  ]);
  const identity = (name) => modelIdentity(name, 'cursor', lookup(name, 'cursor'));
  assert.deepEqual(identity('cursor-grok-4.6-xhigh-fast'), { id: 'grok-4.6-fast', effort: 'xhigh' });
  assert.deepEqual(identity('cursor-grok-4.6-high'), { id: 'grok-4.6', effort: 'high' });
  assert.deepEqual(identity('claude-4.6-opus-high-thinking'), { id: 'claude-opus-4.6', effort: 'high' });
  assert.deepEqual(identity('opus5.5-high'), { id: 'claude-opus-5.5', effort: 'high' });
  assert.deepEqual(identity('claude-opus5.5-medium-thinking'), { id: 'claude-opus-5.5', effort: 'medium' });
  assert.deepEqual(identity('cursor-grok-4.7-500k-fast'), { id: 'grok-4.7-500k-fast', effort: null });
  assert.equal(lookup('cursor-grok-4.6-xhigh-fast', 'cursor').input, 4e-6);
  assert.equal(lookup('cursor-grok-4.6-high', 'cursor').input, 2e-6);
  assert.equal(lookup('opus5.5-high', 'cursor').input, 4e-6);
  assert.equal(lookup('grok-4.6', 'claude').input, 9e-6);
  assert.equal(lookup('auto', 'cursor'), null);
  assert.equal(lookup('cursor-grok-4.6-max', 'cursor').input, 2e-6);
  assert.equal(lookup('composer-2-fast', 'cursor'), null);
  assert.equal(reportModelName('opus5.5-high', 'cursor', lookup('opus5.5-high', 'cursor')), 'Claude Opus 5.5');
  assert.equal(reportModelName('claude-opus-5-5', 'claude'), 'Claude Opus 5.5');
  assert.equal(reportModelName('anthropic/claude-opus-5-5-20260801', 'claude'), 'Claude Opus 5.5');
  assert.equal(reportModelName('gpt-5.6-sol', 'codex'), 'GPT-5.6 Sol');
  assert.equal(reportModelName('cursor-grok-4.7-500k-fast', 'cursor', lookup('cursor-grok-4.7-500k-fast', 'cursor')), 'Grok 4.7 500k (Fast)');
});

test('Cursor Max modes share base prices without collapsing product names or priced variants', () => {
  const lookup = createPriceLookup([
    rate('GPT-5.6 Sol', 4), rate('GPT-5.6 Sol (Fast)', 8), rate('GPT-5.6 Luna', 0.2),
    rate('GPT-5.6 Terra', 2), rate('Claude 4.6 Opus', 5), rate('Claude 4.6 Sonnet', 3),
    rate('Claude 4.7 Opus', 5), rate('Kimi K3', 3), rate('Grok 4.7 500k (Fast)', 6),
    rate('GPT-5.1 Codex', 1), rate('GPT-5.1 Codex Max', 2),
  ]);
  for (const [raw, base] of [
    ['gpt-5.6-sol-max', 'gpt-5.6-sol'], ['gpt-5.6-luna-max', 'gpt-5.6-luna'],
    ['gpt-5.6-terra-max', 'gpt-5.6-terra'], ['kimi-k3-max', 'kimi-k3'],
    ['claude-4.6-opus-max-thinking', 'claude-opus-4-6'],
    ['claude-4.6-sonnet-max-thinking', 'claude-sonnet-4-6'],
    ['claude-opus-4-7-thinking-max', 'claude-opus-4-7'],
    ['cursor-grok-4.7-500k-max-fast', 'grok-4.7-500k-fast'],
    ['gpt-5.6-sol-high-max-fast', 'gpt-5.6-sol-fast'],
    ['gpt-5.6-sol-max-xhigh-fast', 'gpt-5.6-sol-fast'],
  ]) {
    assert.equal(lookup(raw, 'cursor'), lookup(base, 'cursor'), raw);
    assert.ok(lookup(raw, 'cursor'), raw);
    assert.equal(reportModelName(raw, 'cursor', lookup(raw, 'cursor')), reportModelName(base, 'cursor', lookup(base, 'cursor')), raw);
    assert.equal(modelIdentity(raw, 'cursor', lookup(raw, 'cursor')).maxMode, true, raw);
  }
  assert.equal(modelIdentity('gpt-5.6-sol-high-max-fast', 'cursor', lookup('gpt-5.6-sol-high-max-fast', 'cursor')).effort, 'high');
  assert.equal(lookup('gpt-5.1-codex-max-high', 'cursor').input, 2e-6);
  assert.equal(reportModelName('gpt-5.1-codex-max-high', 'cursor', lookup('gpt-5.1-codex-max-high', 'cursor')), 'GPT-5.1 Codex Max');
  assert.equal(modelIdentity('qwen3.8-max', 'cursor').id, 'qwen-3.8-max');
  assert.equal(modelIdentity('unknown-max', 'cursor').id, 'unknown-max');
  assert.equal(lookup('gpt-5.6-sol-max-unknown', 'cursor'), null);
  assert.equal(modelIdentity('gpt-5.6-sol-max', 'codex').id, 'gpt-5.6-sol-max');
  assert.equal(reportModelName('gpt-5.6-sol-max', 'codex'), 'GPT-5.6 Sol Max');
});

test('new catalog families and Max product names work without model-specific code; ambiguous aliases stay unpriced', () => {
  const models = [rate('Nebula Orbit 8.2', 1), rate('Nebula Orbit 8.2 Max', 3), rate('Nebula Orbit 8.2 (Fast)', 5)];
  const lookup = createPriceLookup(models);
  assert.equal(lookup('cursor-nebula-orbit8.2-high', 'cursor'), models[0]);
  assert.equal(lookup('orbit8.2-max-thinking', 'cursor'), models[1]);
  assert.equal(lookup('nebula-orbit-8-2-high-fast', 'cursor'), models[2]);
  assert.equal(modelIdentity('orbit8.2-max-high', 'cursor', models[1]).maxMode, undefined);
  const future = rate('Future Aurora 12.1', 7);
  const refreshed = createPriceLookup([...models, future]);
  assert.equal(refreshed('aurora12.1-max', 'cursor'), future);
  assert.equal(lookup('aurora12.1-max', 'cursor'), null);
  assert.equal(refreshed('aurora12.1-turbo', 'cursor'), null);
  const ambiguous = createPriceLookup([...models, rate('Other Orbit 8.2', 9)]);
  assert.equal(ambiguous('orbit8.2-high', 'cursor'), null);
  assert.equal(ambiguous('nebula-orbit8.2-high', 'cursor'), models[0]);
  const exact = rate('Orbit 8.2', 11);
  assert.equal(createPriceLookup([...models, exact])('orbit8.2-high', 'cursor'), exact);
  assert.equal(reportModelName('unknown-max', 'cursor'), 'unknown-max');
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
