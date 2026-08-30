import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { computeCost, getPricing, normalizeModelName } from '../src/pricing.js';
import * as agg from '../src/aggregate.js';

test('normalizeModelName strips provider prefixes and snapshots', () => {
  assert.equal(normalizeModelName('builtin:GLM-5.3'), 'glm-5.3');
  // Slash-prefixed provider keys are kept intact; suffix matching maps bare
  // model names onto them during lookup.
  assert.equal(normalizeModelName('anthropic/claude-sonnet-4-5'), 'anthropic/claude-sonnet-4-5');
  assert.equal(normalizeModelName('gpt-5.2-20260101'), 'gpt-5.2');
  assert.equal(normalizeModelName('GLM-4.5:latest'), 'glm-4.5');
});

test('builtin pricing matches by prefix', async () => {
  const { priceFor } = await getPricing({ offline: true, env: {} });
  const p = priceFor('GLM-5.3');
  assert.equal(p.source, 'builtin');
  assert.equal(p.input, 0.6e-6);
  const sonnet = priceFor('claude-sonnet-4-5');
  assert.equal(sonnet.input, 3e-6);
});

test('computeCost sums token classes; source cost wins', () => {
  const price = { input: 1e-6, output: 2e-6, cacheRead: 0.5e-6, cacheWrite: 3e-6 };
  const cost = computeCost(
    {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      costUsd: null,
    },
    price,
  );
  assert.equal(cost, 6.5);

  assert.equal(computeCost({ inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.42 }, price), 0.42);
  assert.equal(computeCost({ inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null }, null), null);
});

test('user overrides file wins over builtin (suffix match)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-cfg-'));
  fs.writeFileSync(
    path.join(dir, 'pricing.json'),
    JSON.stringify({ 'zhipuai/glm-5.3': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 } }),
  );
  const { priceFor, sources } = await getPricing({ offline: true, env: { TOKSIGHT_CONFIG_DIR: dir } });
  assert.equal(sources.user, true);
  const p = priceFor('GLM-5.3');
  assert.equal(p.source, 'user');
  assert.equal(p.input, 1e-6);
  assert.equal(p.output, 2e-6);
});

test('aggregate summarize and cache hit rate', () => {
  const entries = [
    { sessionId: 'a', inputTokens: 100, outputTokens: 50, reasoningTokens: 0, cacheReadTokens: 300, cacheWriteTokens: 20, costUsd: 1, model: 'm1' },
    { sessionId: 'b', inputTokens: 100, outputTokens: 50, reasoningTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, model: 'm2' },
  ];
  const t = agg.summarize(entries);
  assert.equal(t.requests, 2);
  assert.equal(t.sessions, 2);
  assert.equal(t.totalTokens, 620);
  assert.equal(t.costUsd, 1);
  assert.equal(t.pricedRequests, 1);
  assert.equal(agg.cacheHitRate(t), 300 / 500);
  assert.equal(agg.cacheHitRate(agg.summarize([])), null);
  assert.deepEqual(agg.unpricedModels(entries), ['m2']);
});

test('daily grouping uses local dates', () => {
  const ts = new Date(2026, 7, 29, 23, 30).getTime(); // local 2026-08-29 23:30
  const rows = agg.byDay([
    { sessionId: 'a', inputTokens: 1, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, model: 'm', timestamp: ts },
    { sessionId: 'a', inputTokens: 1, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, model: 'm', timestamp: null },
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['2026-08-29', 'unknown']);
});
