import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectAll } from '../src/cli.js';

// A tiny live fixture tree: one Claude session with a timestamped entry and
// one without; the other four clients are pointed at roots that do not exist
// (ENOENT is silent — not every agent is installed). Built per test in a temp
// dir so collectAll runs fully offline against controlled data.
function makeFixture({ opencodeDbIsDir = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-cli-'));
  const claudeProjects = path.join(tmp, 'claude', 'projects', 'ProjA');
  fs.mkdirSync(claudeProjects, { recursive: true });
  fs.writeFileSync(
    path.join(claudeProjects, 'sess-x.jsonl'),
    [
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-x',
        message: {
          id: 'msg_a',
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 200 },
        },
        timestamp: '2026-08-29T10:00:00.000Z',
      }),
      // No timestamp on this one — date filters must call it out, not drop it
      // silently.
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-x',
        message: {
          id: 'msg_b',
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 70, cache_read_input_tokens: 100, output_tokens: 40 },
        },
      }),
    ].join('\n'),
  );
  if (opencodeDbIsDir) {
    // opencode.db exists but is a directory: SQLite cannot open it → warning.
    fs.mkdirSync(path.join(tmp, 'opencode', 'opencode.db'), { recursive: true });
  }
  const env = {
    CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'),
    CODEX_HOME: path.join(tmp, 'codex'),
    ZCODE_HOME: path.join(tmp, 'zcode'),
    OPENCODE_PATH: path.join(tmp, 'opencode'),
    KIMI_CODE_HOME: path.join(tmp, 'kimi'),
    TOKSIGHT_CONFIG_DIR: path.join(tmp, 'config'),
  };
  const home = path.join(tmp, 'home');
  return { tmp, env, home };
}

const BASE_OPTS = {
  clients: null,
  since: null,
  until: null,
  top: 20,
  offline: true,
};

test('collectAll collects fixtures, prices entries without mutating them', async () => {
  const { tmp, env, home } = makeFixture();
  try {
    const ctx = await collectAll(BASE_OPTS, { env, home });
    assert.equal(ctx.entries.length, 2);
    assert.ok(ctx.entries.every((e) => e.client === 'claude'));
    assert.deepEqual(ctx.warnings, []);

    // Cost comes from the builtin table (offline, no user pricing.json).
    const priced = ctx.entries.find((e) => e.inputTokens === 100);
    assert.equal(priced.costUsd, 100 * 3e-6 + 900 * 0.3e-6 + 50 * 3.75e-6 + 200 * 15e-6);
    assert.ok(ctx.entries.every((e) => e.costUsd > 0));

    // Pricing produces copies: the parser's own entry lists stay untouched
    // (costUsd null), so collected results are never mutated in place.
    const raw = ctx.perClient.find((c) => c.id === 'claude').entries;
    assert.ok(raw.every((e) => e.costUsd == null));

    // Offline pricing state is surfaced.
    assert.equal(ctx.pricing.sources.litellm, 'skipped (offline)');
    assert.equal(ctx.pricing.sources.user, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('date filters exclude timestamp-less entries with a warning', async () => {
  const { tmp, env, home } = makeFixture();
  const ts = Date.parse('2026-08-29T10:00:00.000Z');
  try {
    // until just after the timestamped entry: only the null-timestamp entry
    // is dropped, and it is counted in the warnings.
    const kept = await collectAll({ ...BASE_OPTS, until: ts + 1000 }, { env, home });
    assert.equal(kept.entries.length, 1);
    assert.equal(kept.entries[0].inputTokens, 100);
    assert.equal(kept.warnings.length, 1);
    assert.match(kept.warnings[0], /1 entries without a timestamp were excluded/);

    // since after everything: everything is filtered, warning still fires.
    const none = await collectAll({ ...BASE_OPTS, since: ts + 1000 }, { env, home });
    assert.equal(none.entries.length, 0);
    assert.equal(none.warnings.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('client filters restrict entries and perClient stays complete', async () => {
  const { tmp, env, home } = makeFixture();
  try {
    const ctx = await collectAll({ ...BASE_OPTS, clients: ['codex'] }, { env, home });
    assert.equal(ctx.entries.length, 0);
    // perClient reports every client regardless of the filter.
    assert.equal(ctx.perClient.length, 5);
    const claude = ctx.perClient.find((c) => c.id === 'claude');
    assert.equal(claude.entries.length, 2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('client warnings (unreadable db) aggregate into collectAll warnings', async () => {
  const { tmp, env, home } = makeFixture({ opencodeDbIsDir: true });
  try {
    const ctx = await collectAll(BASE_OPTS, { env, home });
    assert.equal(ctx.entries.length, 2); // claude entries unaffected
    assert.equal(ctx.warnings.length, 1);
    assert.match(ctx.warnings[0], /^opencode: database unreadable/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
