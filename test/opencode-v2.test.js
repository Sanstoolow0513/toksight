import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import * as opencode from '../src/clients/opencode.js';

const V2 = `
  CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, directory TEXT NOT NULL, title TEXT,
    version TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
  CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  INSERT INTO session_v2 VALUES ('ses_v2', 'prj', 'demo', 'C:\\work\\v2', 'v2 title', '1', 1000, 9000);
`;
const row = (db, idv, type, seq, created, data) =>
  db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)').run(idv, 'ses_v2', type, seq, created, created, typeof data === 'string' ? data : JSON.stringify(data));

function withDb(t, setup) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'toksight-oc-v2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(path.join(dir, 'opencode.db'));
  setup(db);
  db.close();
  return dir;
}

test('opencode reads the session_message / session_v2 layout with measured durations', async (t) => {
  const dir = withDb(t, (db) => {
    db.exec(V2);
    row(db, 'msg_u', 'user', 1, 1000, { time: { created: 1000 }, text: 'x', files: [], agents: [] });
    row(db, 'msg_a', 'assistant', 2, 1100, { time: { created: 1100, streamed: 1500, completed: 3100 }, agent: 'build',
      model: { id: 'gpt-x', providerID: 'openai', variant: 'high' }, finish: 'tool-calls', cost: 0,
      tokens: { input: 400, output: 60, reasoning: 7, cache: { read: 1200, write: 30 } } });
    row(db, 'msg_e', 'assistant', 3, 4000, { time: { created: 4000, completed: 4100 }, model: { id: 'gpt-x', providerID: 'openai' }, finish: 'error', error: { type: 'provider.auth' } });
    row(db, 'msg_z', 'assistant', 4, 5000, { time: { created: 5000, completed: 5200 }, model: { id: 'gpt-x' }, tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } } });
    row(db, 'msg_c', 'assistant', 5, 6000, { time: { created: 6000 }, model: { id: 'k3', providerID: 'kimi' }, cost: 0.25, tokens: { input: 10, output: 5 } });
    row(db, 'msg_bad', 'assistant', 6, 7000, 'not json');
    row(db, 'msg_s', 'synthetic', 7, 7100, { time: { created: 7100 }, text: 'x' });
  });
  const { entries, warnings } = await opencode.collect({ env: { OPENCODE_PATH: dir }, home: os.homedir() });
  assert.deepEqual(warnings, []);
  assert.equal(entries.length, 2); // error, zero-usage, malformed and non-assistant rows skipped
  const [a, c] = entries;
  assert.deepEqual(a, {
    client: 'opencode', sessionId: 'ses_v2', model: 'gpt-x', providerId: 'openai', timestamp: 3100,
    inputTokens: 400, outputTokens: 60, reasoningTokens: 7, cacheReadTokens: 1200, cacheWriteTokens: 30,
    costUsd: null, directory: 'C:\\work\\v2', title: 'v2 title', durationMs: 2000, durationSource: 'measured',
  });
  assert.equal(c.costUsd, 0.25);
  assert.equal(c.timestamp, 6000);
  assert.equal(c.providerId, 'kimi');
  assert.equal(Object.hasOwn(c, 'durationMs'), false); // no completion time
});

test('opencode counts a message present in both layouts once and keeps old-only rows', async (t) => {
  const dir = withDb(t, (db) => {
    db.exec(V2);
    db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);`);
    const old = (idv, input) => db.prepare('INSERT INTO message VALUES (?, ?, ?)').run(idv, 'ses_v2', JSON.stringify({ role: 'assistant', modelID: 'gpt-x',
      tokens: { input, output: 1 }, time: { created: 100, completed: 200 } }));
    old('msg_same', 11);
    old('msg_old', 22);
    row(db, 'msg_same', 'assistant', 1, 100, { time: { created: 100, completed: 200 }, model: { id: 'gpt-x' }, tokens: { input: 11, output: 1 } });
  });
  const { entries, warnings } = await opencode.collect({ env: { OPENCODE_PATH: dir }, home: os.homedir() });
  assert.deepEqual(warnings, []);
  assert.deepEqual(entries.map((e) => e.inputTokens).sort(), [11, 22]);
});

test('opencode warns when the database has neither message layout', async (t) => {
  const dir = withDb(t, (db) => db.exec('CREATE TABLE kv (k TEXT)'));
  const { entries, warnings } = await opencode.collect({ env: { OPENCODE_PATH: dir }, home: os.homedir() });
  assert.equal(entries.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^opencode: message table unavailable/);
});
