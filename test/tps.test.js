import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import * as claude from '../src/clients/claude.js';
import * as codex from '../src/clients/codex.js';
import * as kimi from '../src/clients/kimi.js';
import * as opencode from '../src/clients/opencode.js';
import * as zcode from '../src/clients/zcode.js';
import { createUsageDatabase } from '../src/database.js';
import { readDatabaseBackup } from '../src/dbtransfer.js';
import { usageRows } from '../src/usageimports.js';
import { buildTps } from '../src/webdata.js';
import { MAX_TPS, MIN_TPS_DURATION_MS, durationFields, median, requestTps, tpsSummary } from '../src/tps.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'duration');
const home = os.homedir();
const timing = (entries) => entries.map((e) => [e.outputTokens, e.durationMs ?? null, e.durationSource ?? null]);
const B = 1790000000000;

test('claude infers request time from the parent user line to the last line of the message', async () => {
  const { entries } = await claude.collect({ env: { CLAUDE_CONFIG_DIR: path.join(fixtures, 'claude') }, home });
  assert.deepEqual(timing(entries), [
    [200, 4000, 'inferred'], // u1 (0s) -> last m1 line (4s), largest snapshot kept
    [100, 2500, 'inferred'], // tool_result u2 (5s) -> 7.5s
    [30, null, null], // parent is a system line
    [30, null, null], // parent line missing
  ]);
});

test('codex infers request time between the last input and the usage marker', async () => {
  const { entries } = await codex.collect({ env: { CODEX_HOME: path.join(fixtures, 'codex') }, home });
  assert.deepEqual(timing(entries), [
    [80, 4100, 'inferred'], // user message -> token_usage_record, not the delayed token_count
    [60, 3999, 'inferred'], // previous usage marker -> token_count
    [90, 3000, 'inferred'], // an interrupted response does not stretch the next request
    [90, null, null], // a repeated marker without new output has no timing
  ]);
});

test('kimi measures llm.request to usage.record and drops retried attempts', async () => {
  const { entries } = await kimi.collect({ env: { KIMI_CODE_HOME: path.join(fixtures, 'kimi') }, home });
  assert.deepEqual(timing(entries), [[120, 3000, 'measured'], [40, null, null]]);
});

test('opencode and zcode measure start to completion and skip non-positive spans', async () => {
  const oc = await opencode.collect({ env: { OPENCODE_PATH: path.join(fixtures, 'opencode') }, home });
  assert.deepEqual(timing(oc.entries).sort((a, b) => b[0] - a[0]), [[200, 4000, 'measured'], [20, null, null]]);
  const zc = await zcode.collect({ env: { ZCODE_HOME: path.join(fixtures, 'zcode') }, home });
  assert.deepEqual(timing(zc.entries), [[250, 2500, 'measured']]);
});

test('zcode and opencode databases carry measured durations', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'toksight-tps-db-'));
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.join(tmp, 'zc', 'cli', 'db'), { recursive: true });
    const z = new DatabaseSync(path.join(tmp, 'zc', 'cli', 'db', 'db.sqlite'));
    z.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT);
      CREATE TABLE model_usage (session_id TEXT, model_id TEXT, started_at INTEGER, completed_at INTEGER, input_tokens INTEGER,
        output_tokens INTEGER, reasoning_tokens INTEGER, cache_creation_input_tokens INTEGER, cache_read_input_tokens INTEGER);
      INSERT INTO model_usage VALUES ('s', 'GLM-5.3', 1000, 3000, 10, 100, 0, 0, 0);
      INSERT INTO model_usage VALUES ('s', 'GLM-5.3', 5000, NULL, 10, 100, 0, 0, 0);`);
    z.close();
    assert.deepEqual(timing((await zcode.collect({ env: { ZCODE_HOME: path.join(tmp, 'zc') }, home })).entries), [[100, 2000, 'measured'], [100, null, null]]);
    mkdirSync(path.join(tmp, 'oc'), { recursive: true });
    const o = new DatabaseSync(path.join(tmp, 'oc', 'opencode.db'));
    o.exec('CREATE TABLE session (id TEXT, directory TEXT, title TEXT); CREATE TABLE message (session_id TEXT, data TEXT);');
    o.prepare('INSERT INTO message VALUES (?, ?)').run('s', JSON.stringify({ role: 'assistant', modelID: 'm', time: { created: B, completed: B + 1500 }, tokens: { input: 1, output: 30 } }));
    o.close();
    assert.deepEqual(timing((await opencode.collect({ env: { OPENCODE_PATH: path.join(tmp, 'oc') }, home })).entries), [[30, 1500, 'measured']]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('durationFields keeps only positive integer spans with a known source', () => {
  assert.deepEqual(durationFields(1000, 2500.4, 'measured'), { durationMs: 1500, durationSource: 'measured' });
  assert.deepEqual(durationFields(1000, 1000, 'measured'), {});
  assert.deepEqual(durationFields(2000, 1000, 'inferred'), {});
  assert.deepEqual(durationFields(NaN, 1000, 'inferred'), {});
  assert.deepEqual(durationFields(0, 1000, 'guess'), {});
});

const base = { client: 'opencode', sessionId: 's', model: 'm', timestamp: B, inputTokens: 1, outputTokens: 100, reasoningTokens: 0,
  cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, directory: null, title: null };

test('median TPS ignores missing timing, zero output and implausible spans', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(requestTps({ ...base, durationMs: 2000 }), 50);
  assert.equal(requestTps(base), null);
  assert.equal(requestTps({ ...base, outputTokens: 0, durationMs: 2000 }), null);
  assert.equal(requestTps({ ...base, durationMs: MIN_TPS_DURATION_MS - 1 }), null);
  assert.equal(requestTps({ ...base, durationMs: 60 * 60 * 1000 + 1 }), null);
  assert.equal(requestTps({ ...base, outputTokens: MAX_TPS + 1, durationMs: 1000 }), null);
  assert.deepEqual(tpsSummary([]), { median: null, requests: 0, inferredRequests: 0, inferred: false });
  assert.deepEqual(tpsSummary([base, { ...base, outputTokens: 0, durationMs: 10 }]), { median: null, requests: 0, inferredRequests: 0, inferred: false });
  const mixed = [
    { ...base, durationMs: 1000, durationSource: 'measured' }, // 100
    { ...base, durationMs: 4000, durationSource: 'inferred' }, // 25
    { ...base, durationMs: 3000, durationSource: 'measured' }, // 33.3
    { ...base, durationMs: 10, durationSource: 'measured' }, // too short: ignored
    { ...base, outputTokens: 1e6, durationMs: 100, durationSource: 'measured' }, // absurd: ignored
  ];
  assert.deepEqual(tpsSummary(mixed), { median: 33.3, requests: 3, inferredRequests: 1, inferred: true });
  assert.equal(tpsSummary(mixed.filter((e) => e.durationSource === 'measured')).inferred, false);
});

test('buildTps merges models by display name across agents and buckets hours', () => {
  const entries = [
    { ...base, client: 'claude', model: 'claude-sonnet-4-5', durationMs: 2000, durationSource: 'inferred' },
    { ...base, client: 'opencode', model: 'claude-sonnet-4-5', durationMs: 1000, durationSource: 'measured' },
    { ...base, client: 'opencode', model: 'glm-4.6', durationMs: 4000, durationSource: 'measured' },
    { ...base, client: 'opencode', model: 'glm-4.6' },
  ];
  const tps = buildTps(entries, { timezone: 'UTC' });
  assert.deepEqual(tps.overall, { median: 50, requests: 3, inferredRequests: 1, inferred: true });
  const names = Object.keys(tps.models);
  assert.equal(names.length, 2);
  const sonnet = tps.models[names.find((n) => /sonnet/i.test(n))];
  assert.deepEqual(sonnet, { median: 75, requests: 2, inferredRequests: 1, inferred: true });
  assert.equal(tps.models[names.find((n) => /glm/i.test(n))].inferred, false);
  assert.equal(tps.clients.claude.median, 50);
  assert.equal(tps.hourly.length, 24);
  assert.equal(tps.hourly[new Date(B).getUTCHours()].requests, 3);
  assert.equal(tps.hourly[(new Date(B).getUTCHours() + 1) % 24].median, null);
});

test('duration fields never change usage identities', () => {
  const plain = usageRows([{ entry: base }, { entry: base }]).map((r) => r.fingerprint);
  const timed = usageRows([{ entry: { ...base, durationMs: 1234, durationSource: 'measured' } }, { entry: { ...base, durationMs: 9, durationSource: 'inferred' } }]).map((r) => r.fingerprint);
  assert.deepEqual(timed, plain);
});

const collected = (entries) => ({ entries, warnings: [], reportedCosts: new WeakSet(),
  pricing: { sources: {}, configDir: '/fixture', priceFor: () => null, records: [] } });

test('backups accept entries with and without durations, dedupe across them, and reject bad values', () => {
  const timed = { ...base, durationMs: 2000, durationSource: 'measured' };
  const a = createUsageDatabase({ file: ':memory:' }), b = createUsageDatabase({ file: ':memory:' });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'toksight-tps-backup-'));
  try {
    a.replace(collected([timed, { ...base, sessionId: 'old' }]));
    const bytes = a.exportDatabase();
    const backup = readDatabaseBackup(bytes);
    assert.equal(backup.rows.length, 2);
    b.replace(collected([base]));
    const result = b.importDatabase(bytes);
    assert.deepEqual([result.imported, result.duplicates], [1, 1], 'the timed copy of a local request is a duplicate');
    assert.equal(b.importDatabase(bytes).imported, 0);

    const file = path.join(dir, 'bad.sqlite');
    for (const bad of [{ durationMs: -1 }, { durationMs: 1.5 }, { durationMs: '10' }, { durationMs: 10, durationSource: 'guess' }, { durationSource: 'measured' }]) {
      writeFileSync(file, bytes);
      const db = new DatabaseSync(file);
      db.prepare('UPDATE entries SET data_json = ? WHERE seq = (SELECT MIN(seq) FROM entries)').run(JSON.stringify({ ...base, ...bad }));
      db.close();
      assert.throws(() => readDatabaseBackup(readFileSync(file)), /invalid request duration/, JSON.stringify(bad));
    }
    writeFileSync(file, bytes);
    const db = new DatabaseSync(file);
    db.prepare('UPDATE entries SET data_json = ? WHERE seq = (SELECT MIN(seq) FROM entries)').run(JSON.stringify({ ...base, durationMs: 0 }));
    db.close();
    assert.equal(readDatabaseBackup(readFileSync(file)).rows.length, 2, 'a zero duration is valid (it just yields no TPS)');
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});
