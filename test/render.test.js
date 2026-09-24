import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pricingModelsTable, sessionsTable } from '../src/render.js';
import { createFormatter } from '../src/format.js';

const fmt = createFormatter({ color: false });

// Same entry shape the parsers emit (see payload.test.js).
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

test('sessions table renders unknown (not 1970) for a timestamp-less session', () => {
  // aggregate.group() emits null (never Infinity/0 sentinels) when a session
  // has no finite timestamps; the table must show 'unknown', not the epoch.
  const table = sessionsTable([entry({ timestamp: null })], { top: 20 }, fmt);
  assert.match(table, /unknown/);
  assert.doesNotMatch(table, /1970/);
});

test('sessions table renders the last-active datetime for timestamped sessions', () => {
  const table = sessionsTable([entry()], { top: 20 }, fmt);
  assert.match(table, /2026-08-10 12:00/);
  assert.doesNotMatch(table, /unknown/);
});

test('model table distinguishes unpriced usage from a reported free request', () => {
  const table = pricingModelsTable([
    entry({ model: 'unknown-model', costUsd: null }),
    entry({ model: 'free-model', costUsd: 0 }),
  ], { top: 20 }, fmt);
  assert.match(table, /unknown-model\s+1\s+10\s+0\s+0\s+5\s+0\.0%\s+—/);
  assert.match(table, /free-model\s+1\s+10\s+0\s+0\s+5\s+0\.0%\s+\$0\.0000/);
});
