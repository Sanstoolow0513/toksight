import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as claude from '../src/clients/claude.js';
import * as codex from '../src/clients/codex.js';
import * as opencode from '../src/clients/opencode.js';
import * as kimi from '../src/clients/kimi.js';
import * as zcode from '../src/clients/zcode.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('claude parser dedupes message ids, keeping the largest usage snapshot', async () => {
  const { entries } = await claude.collect({
    env: { CLAUDE_CONFIG_DIR: path.join(fixtures, 'claude') },
    home: os.homedir(),
  });
  // msg_1 (duplicate lines), msg_2, msg_4, msg_5 kept; msg_3 zero-usage skipped
  assert.equal(entries.length, 4);
  const first = entries[0];
  assert.equal(first.client, 'claude');
  assert.equal(first.sessionId, 'sess-a');
  assert.equal(first.model, 'claude-sonnet-4-5');
  assert.equal(first.inputTokens, 100);
  assert.equal(first.cacheReadTokens, 900);
  assert.equal(first.cacheWriteTokens, 50);
  assert.equal(first.outputTokens, 200);
  assert.equal(first.timestamp, Date.parse('2026-08-29T10:00:00.000Z'));
  assert.equal(first.directory, 'C--Users-test-proj');

  // msg_4: same id re-emitted with growing usage (streaming partial -> final)
  const grown = entries.find((e) => e.inputTokens === 30);
  assert.equal(grown.outputTokens, 250);

  // msg_5: a later, smaller snapshot must not shrink the kept entry
  const shrunk = entries.find((e) => e.inputTokens === 70);
  assert.equal(shrunk.outputTokens, 40);
  assert.equal(shrunk.cacheReadTokens, 100);
});

test('codex parser prefers last_token_usage and diffs cumulative totals', async () => {
  const { entries } = await codex.collect({
    env: { CODEX_HOME: path.join(fixtures, 'codex') },
    home: os.homedir(),
  });
  assert.equal(entries.length, 3);

  assert.equal(entries[0].sessionId, 'sess_codex1');
  assert.equal(entries[0].model, 'gpt-5.2');
  assert.equal(entries[0].directory, 'C:\\work\\demo');
  assert.equal(entries[0].inputTokens, 20); // 100 - 80 cached
  assert.equal(entries[0].cacheReadTokens, 80);
  assert.equal(entries[0].outputTokens, 10);
  assert.equal(entries[0].reasoningTokens, 4);

  assert.equal(entries[1].inputTokens, 30); // 150 - 120
  assert.equal(entries[1].cacheReadTokens, 120);
  assert.equal(entries[1].outputTokens, 30);

  // Legacy cumulative-only event: diff vs previous total (500-250, 280-200, ...)
  assert.equal(entries[2].inputTokens, 170); // 250 fresh - 80 cached
  assert.equal(entries[2].cacheReadTokens, 80);
  assert.equal(entries[2].outputTokens, 20);
});

test('opencode parser keeps assistant messages and source cost', async () => {
  const { entries, warnings } = await opencode.collect({
    env: { OPENCODE_PATH: path.join(fixtures, 'opencode') },
    home: os.homedir(),
  });
  // No opencode.db in this fixture, so it falls back to the legacy JSON
  // storage layout — silently, since a missing db just means the agent
  // never wrote one.
  assert.equal(warnings.length, 0);
  assert.equal(entries.length, 2);
  const first = entries.find((e) => e.sessionId === 'sess1');
  assert.equal(first.model, 'claude-sonnet-4-5');
  assert.equal(first.costUsd, 0.0123);
  assert.equal(first.cacheReadTokens, 200);
  assert.equal(first.cacheWriteTokens, 20);
  assert.equal(first.timestamp, 1788000000000);
  const second = entries.find((e) => e.sessionId === 'sess2');
  assert.equal(second.costUsd, null);
});

test('opencode db parser reads message rows when sqlite is available', async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    t.skip('node:sqlite unavailable on this Node version');
    return;
  }
  const tmp = path.join(os.tmpdir(), `toksight-test-${Date.now()}-oc`);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(tmp, { recursive: true });
  const db = new DatabaseSync(path.join(tmp, 'opencode.db'));
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);
    INSERT INTO session VALUES ('ses_db1', 'C:\\work\\oc', 'oc title');
    INSERT INTO message VALUES ('msg_1', 'ses_db1', '{"role":"assistant","modelID":"glm-5.3","tokens":{"input":1000,"output":40,"reasoning":5,"cache":{"read":300,"write":0}},"cost":0,"time":{"created":1000,"completed":2000}}');
    INSERT INTO message VALUES ('msg_2', 'ses_db1', '{"role":"user","modelID":"glm-5.3","tokens":{"input":10,"output":0}}');
    INSERT INTO message VALUES ('msg_3', 'ses_db1', '{"role":"assistant","modelID":"glm-5.3","tokens":{"input":0,"output":0},"time":{"created":3000}}');
    INSERT INTO message VALUES ('msg_4', 'ses_db1', '{"role":"assistant","modelID":"glm-5.3","tokens":{"input":50,"output":10},"cost":0.02,"time":{"created":4000,"completed":5000}}');
    INSERT INTO message VALUES ('msg_5', 'ses_db1', 'not json');
  `);
  db.close();

  const { entries, warnings } = await opencode.collect({ env: { OPENCODE_PATH: tmp }, home: os.homedir() });
  assert.equal(entries.length, 2); // user row, zero-usage row and malformed row skipped
  const first = entries[0];
  assert.equal(first.client, 'opencode');
  assert.equal(first.sessionId, 'ses_db1');
  assert.equal(first.model, 'glm-5.3');
  assert.equal(first.directory, 'C:\\work\\oc');
  assert.equal(first.title, 'oc title');
  assert.equal(first.timestamp, 2000); // time.completed preferred
  assert.equal(first.inputTokens, 1000);
  assert.equal(first.outputTokens, 40);
  assert.equal(first.reasoningTokens, 5);
  assert.equal(first.cacheReadTokens, 300);
  assert.equal(first.cacheWriteTokens, 0);
  assert.equal(first.costUsd, null); // cost:0 is a placeholder in db-era rows
  assert.equal(entries[1].costUsd, 0.02);
  assert.equal(entries[1].timestamp, 5000);
  assert.equal(warnings.length, 0);
});

test('opencode parser warns when the db exists but cannot be read', async () => {
  const tmp = path.join(os.tmpdir(), `toksight-test-${Date.now()}-oc-dir`);
  const { mkdirSync } = await import('node:fs');
  // A directory where opencode.db should be: it exists, but SQLite cannot open it.
  mkdirSync(path.join(tmp, 'opencode.db'), { recursive: true });
  const { entries, warnings } = await opencode.collect({ env: { OPENCODE_PATH: tmp }, home: os.homedir() });
  assert.equal(entries.length, 0); // no legacy JSON storage either
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^opencode: database unreadable/);
});

test('kimi parser reads wire.jsonl usage records and state metadata', async () => {
  const { entries, warnings } = await kimi.collect({
    env: { KIMI_CODE_HOME: path.join(fixtures, 'kimi') },
    home: os.homedir(),
  });
  assert.equal(warnings.length, 0);
  // 3 kept main records (zero-usage, usage-less and malformed lines dropped)
  // + 1 sub-agent record + 1 from the state.json-less session
  assert.equal(entries.length, 5);

  const first = entries.find((e) => e.timestamp === 1788000001000);
  assert.equal(first.client, 'kimi');
  assert.equal(first.sessionId, 'session_test1');
  assert.equal(first.model, 'kimi-code/k3');
  assert.equal(first.directory, 'C:\\work\\demo');
  assert.equal(first.title, 'fix the bug');
  assert.equal(first.inputTokens, 100);
  assert.equal(first.outputTokens, 50);
  assert.equal(first.cacheReadTokens, 900);
  assert.equal(first.cacheWriteTokens, 25);
  assert.equal(first.reasoningTokens, 0);
  assert.equal(first.costUsd, null);

  // session-scope records (e.g. title generation) are real spend too
  assert.ok(entries.some((e) => e.timestamp === 1788000003000));
  // sub-agent usage is collected alongside main
  assert.ok(entries.some((e) => e.timestamp === 1788000006000));

  // session without state.json: falls back to directory names
  const orphan = entries.find((e) => e.timestamp === 1788000007000);
  assert.equal(orphan.sessionId, 'session_test2');
  assert.equal(orphan.directory, 'wd_demo_abc');
  assert.equal(orphan.title, null);
});

test('zcode rollout parser splits cache reads from total prompt and skips empty', async () => {
  const { entries, warnings } = await zcode.collect({
    env: { ZCODE_HOME: path.join(fixtures, 'zcode') },
    home: os.homedir(),
  });
  // The db is absent in this fixture, so it falls back to rollout — silently,
  // since a missing db just means the agent never wrote one.
  assert.equal(warnings.length, 0);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.client, 'zcode');
  assert.equal(e.model, 'GLM-5.3');
  assert.equal(e.inputTokens, 500); // 1000 total prompt - 500 cached (writes excluded from input)
  assert.equal(e.outputTokens, 100);
  assert.equal(e.cacheReadTokens, 500);
  assert.equal(e.cacheWriteTokens, 50);
  assert.equal(e.timestamp, Date.parse('2026-08-29T10:00:05.000Z'));
});

test('zcode parser warns when the db exists but cannot be read', async () => {
  const tmp = path.join(os.tmpdir(), `toksight-test-${Date.now()}-zc-dir`);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.join(tmp, 'cli', 'db', 'db.sqlite'), { recursive: true });
  const { entries, warnings } = await zcode.collect({ env: { ZCODE_HOME: tmp }, home: os.homedir() });
  assert.equal(entries.length, 0); // no rollout logs either
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^zcode: database unreadable/);
});

test('zcode db parser reads model_usage when sqlite is available', async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    t.skip('node:sqlite unavailable on this Node version');
    return;
  }
  const tmp = path.join(os.tmpdir(), `toksight-test-${Date.now()}`);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.join(tmp, 'cli', 'db'), { recursive: true });
  const db = new DatabaseSync(path.join(tmp, 'cli', 'db', 'db.sqlite'));
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT);
    CREATE TABLE model_usage (
      session_id TEXT, model_id TEXT, started_at INTEGER, completed_at INTEGER,
      input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
      cache_creation_input_tokens INTEGER, cache_read_input_tokens INTEGER
    );
    INSERT INTO session VALUES ('sess_db1', 'C:\\work\\demo', 'demo title');
    INSERT INTO model_usage VALUES ('sess_db1', 'GLM-5.3', 1000, 2000, 100, 10, 0, 5, 50);
    INSERT INTO model_usage VALUES ('sess_db1', 'GLM-5.3', 3000, 4000, 0, 0, 0, 0, 0);
  `);
  db.close();

  const { entries } = await zcode.collect({ env: { ZCODE_HOME: tmp }, home: os.homedir() });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sessionId, 'sess_db1');
  assert.equal(entries[0].directory, 'C:\\work\\demo');
  assert.equal(entries[0].title, 'demo title');
  assert.equal(entries[0].timestamp, 2000);
  assert.equal(entries[0].cacheReadTokens, 50);
  assert.equal(entries[0].cacheWriteTokens, 5);
  assert.equal(entries[0].inputTokens, 50); // 100 total prompt - 50 cached
});
