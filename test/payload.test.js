import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPayload } from '../src/cli.js';

// Base entry: 2026-08-10 12:00 local time — same shape the parsers emit.
function entry(over = {}) {
  return {
    client: 'claude',
    sessionId: 's1',
    model: 'm1',
    timestamp: new Date(2026, 7, 10, 12).getTime(),
    inputTokens: 10,
    outputTokens: 5,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.01,
    directory: null,
    title: null,
    ...over,
  };
}

function payload(entries, opts = {}) {
  return buildPayload({
    entries,
    warnings: [],
    pricing: { sources: { builtin: true }, configDir: null },
    opts: { clients: null, since: null, until: null, top: 20, ...opts },
  });
}

test('payload clients expose per-agent cache hit rate', () => {
  const entries = [
    entry({ client: 'claude', inputTokens: 200, cacheReadTokens: 300 }),
    entry({ client: 'claude', sessionId: 's2', inputTokens: 100, cacheReadTokens: 0 }),
    entry({ client: 'codex', model: 'm2', sessionId: 's3', inputTokens: 100, cacheReadTokens: 100 }),
    entry({ client: 'kimi', model: 'm3', sessionId: 's4', inputTokens: 0, cacheReadTokens: 0 }),
  ];
  const p = payload(entries);
  assert.equal(p.clients.claude.cacheHitRate, 300 / 600); // pooled across requests
  assert.equal(p.clients.codex.cacheHitRate, 100 / 200);
  assert.equal(p.clients.kimi.cacheHitRate, null); // no prompt tokens at all
  assert.equal(p.clients.claude.totalTokens, 610);
  assert.equal(p.clients.claude.requests, 2);
});

test('payload clients key set matches clients present in entries', () => {
  const entries = [
    entry({ client: 'claude' }),
    entry({ client: 'kimi', model: 'm3', sessionId: 's4' }),
  ];
  const p = payload(entries);
  assert.deepEqual([...Object.keys(p.clients)].sort(), ['claude', 'kimi']);

  // Per-agent slices come from the same entries as every other payload slice:
  // summing them must reproduce the overall totals.
  for (const key of ['requests', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'totalTokens']) {
    const sum = Object.values(p.clients).reduce((acc, c) => acc + c[key], 0);
    assert.equal(sum, p.totals[key], `clients sum of ${key}`);
  }
});

test('payload clients respect filters via the filtered entries', () => {
  const old = new Date(2026, 7, 9, 12).getTime();
  const recent = new Date(2026, 7, 11, 12).getTime();
  const entries = [
    entry({ client: 'claude', timestamp: old }),
    entry({ client: 'codex', model: 'm2', sessionId: 's3', timestamp: recent }),
  ];

  // collectAll applies the filters before buildPayload sees the entries, so
  // simulate that by pre-filtering — clients must reflect what it receives.
  const clientFiltered = payload(entries.filter((e) => e.client === 'codex'), { clients: ['codex'] });
  assert.deepEqual(Object.keys(clientFiltered.clients), ['codex']);
  assert.deepEqual(clientFiltered.clientsFilter, ['codex']);

  const sinceFiltered = payload(entries.filter((e) => e.timestamp >= new Date(2026, 7, 10).getTime()), {
    since: new Date(2026, 7, 10).getTime(),
  });
  assert.deepEqual(Object.keys(sinceFiltered.clients), ['codex']);
});

test('payload models rows keep per-(client, model) cache hit rate', () => {
  const entries = [
    entry({ model: 'm1', inputTokens: 100, cacheReadTokens: 100 }),
    entry({ model: 'm1', inputTokens: 100, cacheReadTokens: 300, sessionId: 's2' }),
  ];
  const p = payload(entries);
  assert.equal(p.models.length, 1);
  assert.equal(p.models[0].client, 'claude');
  assert.equal(p.models[0].model, 'm1');
  assert.equal(p.models[0].cacheHitRate, 400 / 600);
});
