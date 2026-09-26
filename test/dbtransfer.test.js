import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createUsageDatabase } from '../src/database.js';
import { readDatabaseBackup } from '../src/dbtransfer.js';
import { runDatabaseTransfer } from '../src/dbcommand.js';
import { parseArgs } from '../src/args.js';
import { collectAll } from '../src/collect.js';
import { parseCursorCsv } from '../src/cursorcsv.js';
import { priceRecord } from '../src/pricecatalog.js';
import { buildCostCoverage } from '../src/costcoverage.js';
import { createWebDataService } from '../src/webservice.js';

const rate = { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0.001, source: 'user' };
const entry = (extra = {}) => ({ client: 'opencode', sessionId: 'one', model: 'backup-only', timestamp: Date.parse('2026-08-12T12:00:00Z'),
  inputTokens: 100, outputTokens: 20, reasoningTokens: 0, cacheReadTokens: 10, cacheWriteTokens: 0,
  costUsd: 0.141, directory: 'C:\\project', title: 'portable', ...extra });
const collected = (entries, reported = []) => ({ entries, warnings: [], reportedCosts: new WeakSet(reported),
  pricing: { sources: { user: true }, configDir: '/fixture', priceFor: () => rate,
    records: [priceRecord({ ...rate, name: 'backup-only' })] } });
const csv = 'Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n' +
  '2026-08-15T12:00:00Z,,,Included,cursor-backup,No,0,10,30,2,42,Included\n';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-transfer-test-'));
  const cleanup = [];
  t.after(async () => { for (const close of cleanup) close(); await rm(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'usage.sqlite');
  const env = { TOKSIGHT_CONFIG_DIR: dir, CLAUDE_CONFIG_DIR: path.join(dir, 'claude'), CODEX_HOME: path.join(dir, 'codex'),
    OPENCODE_PATH: path.join(dir, 'opencode'), ZCODE_HOME: path.join(dir, 'zcode'), KIMI_CODE_HOME: path.join(dir, 'kimi') };
  return { dir, file, env, home: dir, cleanup };
}

test('SQLite backup includes WAL, prices and Cursor; merging is durable, idempotent and portable again', async (t) => {
  const ctx = await fixture(t);
  const source = createUsageDatabase({ file: path.join(ctx.dir, 'source.sqlite') });
  const target = createUsageDatabase({ file: ctx.file });
  const observer = createUsageDatabase({ file: ctx.file });
  const third = createUsageDatabase({ file: ':memory:' });
  ctx.cleanup.push(() => { source.close(); target.close(); observer.close(); third.close(); });
  const reported = entry({ sessionId: 'reported', costUsd: 4 });
  source.replace(collected([entry(), entry(), reported], [reported]));
  source.importCursor(parseCursorCsv(csv).records, undefined, {
    state: 'fresh', priceFor: () => ({ ...rate, source: 'cursor' }),
    records: [priceRecord({ ...rate, source: 'cursor', scope: 'cursor', name: 'cursor-backup' })],
  });
  const local = entry({ sessionId: 'target-only', costUsd: 7 });
  target.replace(collected([local, entry()], [local]));
  assert.equal(observer.read().entries.length, 2);
  const bytes = source.exportDatabase();
  assert.equal(bytes.subarray(0, 16).toString(), 'SQLite format 3\0');
  const first = target.importDatabase(bytes);
  assert.deepEqual([first.imported, first.duplicates, first.entries], [3, 1, 5]);
  assert.equal(observer.read().entries.length, 5);
  assert.deepEqual([target.importDatabase(bytes).imported, target.read().entries.length], [0, 5]);
  target.replace(collected([]));
  assert.equal(target.read().entries.length, 4, 'all imported rows survive refresh, including those originally local');
  assert.equal(target.read().reportedCosts.has(target.read().entries.find((e) => e.sessionId === 'reported')), true);
  assert.ok(Math.abs(target.read().entries.find((e) => e.client === 'cursor').costUsd - 0.017) < 1e-12);
  assert.equal(third.importDatabase(target.exportDatabase()).entries, 4);
  assert.equal(third.importDatabase(bytes).duplicates, 4);

  const cli = await collectAll({ offline: true, clients: null, since: null, until: null }, ctx);
  assert.equal(cli.entries.length, 4);
  assert.ok(Math.abs(cli.entries.find((e) => e.client === 'cursor').costUsd - 0.017) < 1e-12);
  assert.equal(buildCostCoverage(cli.entries, cli).sources.reported.requests, 1);
  assert.equal(buildCostCoverage(cli.entries, cli).sources.cursor.requests, 1);
  assert.equal(cli.perClient.find((c) => c.id === 'opencode').entries.length, 3);
  const filtered = await collectAll({ offline: true, clients: ['opencode'], since: null, until: null }, ctx);
  assert.equal(filtered.entries.length, 3);
});

test('overlapping backups preserve identical occurrences and known charges; a reported cost fills an estimate', () => {
  const a = createUsageDatabase({ file: ':memory:' }), b = createUsageDatabase({ file: ':memory:' });
  try {
    const charged = entry({ costUsd: 2 });
    a.replace(collected([charged], [charged]));
    b.replace(collected([entry()]));
    assert.equal(b.importDatabase(a.exportDatabase()).updated, 1);
    assert.equal(b.read().entries[0].costUsd, 2);
    const newer = entry({ costUsd: 3 });
    a.replace(collected([newer], [newer]));
    assert.equal(b.importDatabase(a.exportDatabase()).duplicates, 1);
    assert.equal(b.read().entries[0].costUsd, 2);
  } finally { a.close(); b.close(); }
});

test('invalid, future-version and incomplete databases fail before changing committed usage', async (t) => {
  const ctx = await fixture(t);
  const db = createUsageDatabase({ file: ':memory:' });
  ctx.cleanup.push(() => db.close());
  db.replace(collected([entry()]));
  const initial = db.read();
  assert.throws(() => db.importDatabase(Buffer.from('not sqlite')), { code: 'BAD_DATABASE' });
  for (const sql of [
    'UPDATE snapshot_meta SET schema_version = 99',
    'UPDATE snapshot_meta SET entry_count = 9',
    "UPDATE entries SET data_json = '{}'",
    'CREATE VIEW malicious AS SELECT * FROM entries',
  ]) {
    const file = path.join(ctx.dir, 'invalid.sqlite');
    await writeFile(file, db.exportDatabase());
    const broken = new DatabaseSync(file);
    broken.exec(sql); broken.close();
    assert.throws(() => db.importDatabase(readFileSync(file)), { code: 'BAD_DATABASE' });
    assert.strictEqual(db.read(), initial);
  }
});

test('CLI transfer accepts paths, rejects filters and refuses to overwrite existing files', async (t) => {
  const ctx = await fixture(t);
  const db = createUsageDatabase({ file: ctx.file });
  db.replace(collected([entry()])); db.close();
  const file = path.join(ctx.dir, 'backup with spaces.sqlite');
  const out = await runDatabaseTransfer(parseArgs(['export-db', file, '--json']), ctx);
  assert.equal(out.entries, 1);
  assert.equal(readDatabaseBackup(await readFile(file)).rows.length, 1);
  await assert.rejects(runDatabaseTransfer(parseArgs(['export-db', file]), ctx), { code: 'EEXIST' });
  const merged = await runDatabaseTransfer(parseArgs(['import-db', file]), ctx);
  assert.equal(merged.duplicates, 1);
  assert.throws(() => parseArgs(['import-db']), /requires a file/);
  assert.throws(() => parseArgs(['export-db', file, '--client=claude']), /filters are not supported/);
  assert.equal(parseArgs(['export-db', '--help']).help, true);
});

test('web database export includes every agent and date regardless of report startup scope', async (t) => {
  const db = createUsageDatabase({ file: ':memory:' });
  db.replace(collected([entry(), entry({ client: 'codex', sessionId: 'elsewhere', timestamp: Date.parse('2025-01-01') })]));
  const service = createWebDataService({ offline: true, clients: ['opencode'], since: Date.parse('2026-01-01'), until: null, top: 20 }, { database: db });
  t.after(() => service.close());
  assert.equal((await service()).totals.requests, 1);
  assert.equal(readDatabaseBackup(await service.exportDatabase()).rows.length, 2);
});

test('a write failure rolls the entire import back and a concurrent web refresh preserves imported history', async (t) => {
  const ctx = await fixture(t);
  const target = createUsageDatabase({ file: ctx.file }), source = createUsageDatabase({ file: ':memory:' });
  ctx.cleanup.push(() => { target.close(); source.close(); });
  target.replace(collected([entry({ sessionId: 'original' })]));
  source.replace(collected([entry({ sessionId: 'first' }), entry({ sessionId: 'reject' })]));
  const sql = new DatabaseSync(ctx.file);
  sql.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON usage_imports
    WHEN json_extract(NEW.data_json, '$.sessionId') = 'reject'
    BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`);
  assert.throws(() => target.importDatabase(source.exportDatabase()), /injected write failure/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM usage_imports').get().n, 0);
  assert.deepEqual(target.read().entries.map((e) => e.sessionId), ['original']);
  sql.exec('DROP TRIGGER fail_import'); sql.close();
  let finish;
  const get = createWebDataService({ offline: true }, { database: target, collect: () => new Promise((resolve) => { finish = resolve; }) });
  const refresh = get.refresh();
  await Promise.resolve();
  const importing = get.importDatabase(source.exportDatabase());
  finish(collected([entry({ sessionId: 'rescanned' })]));
  await refresh;
  assert.equal((await importing).entries, 3);
  assert.deepEqual(new Set(target.read().entries.map((e) => e.sessionId)), new Set(['rescanned', 'first', 'reject']));
});
