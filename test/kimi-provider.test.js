import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import * as kimi from '../src/clients/kimi.js';

function wire(t, agents) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'toksight-kimi-provider-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const [agent, lines] of Object.entries(agents)) {
    const dir = path.join(home, 'sessions', 'wd', 'session_p', 'agents', agent);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'wire.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }
  return home;
}
const usage = (time, model, usageScope, agentId = 'main') =>
  ({ type: 'usage.record', agentId, model, usage: { inputOther: 10, output: 5 }, usageScope, time });
const provided = (entries) => entries.sort((a, b) => a.timestamp - b.timestamp).map((e) => [e.timestamp, e.providerId ?? null]);

test('kimi pairs providers by request model, not kind vs usageScope', async (t) => {
  const home = wire(t, {
    main: [
      // Current logs: `loop` requests report `turn` usage; `provider` is the wire
      // protocol and the configured `<provider>/<model>` key is in modelAlias.
      { type: 'llm.request', agentId: 'main', kind: 'loop', provider: 'openai', model: 'k3', modelAlias: 'kimi-code/k3', time: 1000 },
      usage(2000, 'kimi-code/k3', 'turn'),
      { type: 'llm.request', agentId: 'main', kind: 'compaction', provider: 'openai', model: 'k3', modelAlias: 'kimi-code/k3', time: 3000 },
      usage(4000, 'kimi-code/k3', 'session'),
      // Older logs: `provider` is the configured provider and `model` is the usage model.
      { type: 'llm.request', agentId: 'main', kind: 'turn', provider: 'my-gateway', model: 'custom/k2', modelAlias: 'k2', time: 5000 },
      usage(6000, 'custom/k2', 'turn'),
      usage(6500, 'custom/k2', 'turn'), // second record for the same request keeps its provider
      // A record whose model no request used gets no provider.
      usage(7000, 'other-model', 'turn'),
      // Alias without a namespace carries no provider.
      { type: 'llm.request', agentId: 'main', kind: 'loop', provider: 'openai', model: 'k9', modelAlias: 'plain', time: 8000 },
      usage(9000, 'plain', 'turn'),
    ],
    // A sub-agent's requests never lend their provider to another agent.
    sub: [
      { type: 'llm.request', agentId: 'helper', kind: 'loop', provider: 'openai', model: 'k3', modelAlias: 'kimi-code/k3', time: 10000 },
      usage(11000, 'kimi-code/k3', 'turn', 'other'),
    ],
  });
  const { entries, warnings } = await kimi.collect({ env: { KIMI_CODE_HOME: home }, home });
  assert.deepEqual(warnings, []);
  assert.deepEqual(provided(entries), [
    [2000, 'kimi-code'], [4000, 'kimi-code'], [6000, 'my-gateway'], [6500, 'my-gateway'],
    [7000, null], [9000, null], [11000, null],
  ]);
  const timed = entries.find((e) => e.timestamp === 4000);
  assert.equal(timed.durationMs, 1000);
  assert.equal(timed.durationSource, 'measured');
});
