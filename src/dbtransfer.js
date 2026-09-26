// Backups are standalone SQLite files. Import reads only known tables from an
// isolated, read-only copy; no SQL from the uploaded schema runs in the live DB.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { selectCursorImports } from './cursorcsv.js';
import { mergeUsageRows, usageRows } from './usageimports.js';

export const MAX_DATABASE_BYTES = 256 * 1024 * 1024;
const HEADER = Buffer.from('SQLite format 3\0');
const CLIENTS = new Set(['claude', 'codex', 'opencode', 'zcode', 'kimi', 'cursor']);
const tokenFields = ['inputTokens', 'outputTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens'];
const rateFields = ['input', 'output', 'cacheRead', 'cacheWrite'];
const fields = ['client', 'sessionId', 'model', 'timestamp', ...tokenFields, 'costUsd', 'directory', 'title'];
const object = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const nullableText = (v) => v === null || typeof v === 'string';
const nonnegative = (v) => Number.isFinite(v) && v >= 0;
const bit = (v) => v === 0 || v === 1;
function check(ok, message) { if (!ok) throw new Error(message); }
function price(value) {
  check(value === null || (object(value) && rateFields.every((key) => nonnegative(value[key]))), 'invalid model price');
  return value;
}
function record(row, cursor = false) {
  const entry = JSON.parse(row.data_json);
  check(object(entry) && fields.every((field) => Object.hasOwn(entry, field)) &&
    Object.keys(entry).length === fields.length, 'invalid usage record');
  check(CLIENTS.has(entry.client) && (cursor ? entry.client === 'cursor' : entry.client !== 'cursor'), 'invalid agent');
  check(typeof entry.model === 'string' && nullableText(entry.sessionId) && nullableText(entry.title) && nullableText(entry.directory), 'invalid usage text');
  check(entry.timestamp === null || (Number.isSafeInteger(entry.timestamp) && Math.abs(entry.timestamp) <= 8640000000000000), 'invalid timestamp');
  check(tokenFields.every((key) => Number.isSafeInteger(entry[key]) && entry[key] >= 0), 'invalid token count');
  check(entry.costUsd === null || nonnegative(entry.costUsd), 'invalid cost');
  check(bit(row.reported_cost) && (!row.reported_cost || entry.costUsd !== null), 'invalid cost provenance');
  if (cursor) {
    check(bit(row.included) && typeof row.fingerprint === 'string', 'invalid Cursor import');
    const occurrence = Number(row.fingerprint.split(':').at(-1));
    check(Number.isSafeInteger(occurrence) && occurrence >= 0 && occurrence < 1000000, 'invalid Cursor occurrence');
    check(entry.sessionId === null, 'invalid Cursor session');
  }
  return { ...row, entry };
}

export function withTemporaryDatabase(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'toksight-backup-'));
  try { return fn(path.join(dir, 'usage.sqlite')); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

export function exportDatabaseBytes(db) {
  return withTemporaryDatabase((file) => {
    // VACUUM INTO includes committed WAL data and produces a single file.
    db.prepare('VACUUM INTO ?').run(file);
    const bytes = readFileSync(file);
    check(bytes.length <= MAX_DATABASE_BYTES, 'database exceeds the 256 MB transfer limit');
    return bytes;
  });
}

export function readDatabaseBackup(bytes) {
  try {
    check(Buffer.isBuffer(bytes) && bytes.length <= MAX_DATABASE_BYTES, 'database exceeds the 256 MB transfer limit');
    check(bytes.subarray(0, HEADER.length).equals(HEADER), 'expected a toksight SQLite database');
    return withTemporaryDatabase((file) => {
      writeFileSync(file, bytes);
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        db.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON');
        const schema = db.prepare('SELECT name, type FROM sqlite_master').all();
        check(!schema.some((s) => s.type === 'view' || s.type === 'trigger'), 'views and triggers are not supported');
        const tables = new Set(schema.filter((s) => s.type === 'table').map((s) => s.name));
        for (const name of ['snapshot_meta', 'entries', 'cursor_imports', 'model_prices', 'price_updates']) {
          check(tables.has(name), `missing toksight table ${name}`);
        }
        check(db.prepare('PRAGMA quick_check').get().quick_check === 'ok', 'database integrity check failed');
        const metas = db.prepare('SELECT * FROM snapshot_meta').all();
        check(metas.length === 1 && metas[0].schema_version === 1 && metas[0].id === 1, 'unsupported toksight database version or missing snapshot');
        const meta = metas[0];
        check(Number.isFinite(Date.parse(meta.refreshed_at)), 'invalid snapshot date');
        const warnings = JSON.parse(meta.warnings_json), sources = JSON.parse(meta.pricing_sources_json);
        check(Array.isArray(warnings) && warnings.every((s) => typeof s === 'string') && object(sources), 'invalid snapshot metadata');
        const prices = JSON.parse(meta.model_prices_json);
        check(Array.isArray(prices) && prices.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string'), 'invalid prices');
        prices.forEach((p) => price(p[1]));
        const rows = db.prepare('SELECT * FROM entries ORDER BY seq').all();
        check(rows.length === meta.entry_count, 'incomplete snapshot');
        rows.forEach((row) => { const r = record(row); check(r.entry.client === row.client && r.entry.timestamp === row.timestamp, 'inconsistent usage index'); });
        const imports = tables.has('usage_imports') ? db.prepare('SELECT * FROM usage_imports ORDER BY rowid').all().map((row) => {
          const r = record(row);
          r.price = price(JSON.parse(row.price_json));
          return r;
        }) : [];
        // Recompute identities from data instead of trusting uploaded hashes.
        const canonical = usageRows(imports);
        canonical.forEach((row, i) => check(row.fingerprint === imports[i].fingerprint, 'invalid imported usage identity'));
        const included = db.prepare('PRAGMA table_info(cursor_imports)').all().some((c) => c.name === 'included');
        const cursor = db.prepare(`SELECT rowid, fingerprint, data_json, reported_cost, ${included ? 'included' : '1 AS included'} FROM cursor_imports ORDER BY rowid`).all();
        cursor.forEach((row) => {
          record(row, true);
          check(Number(row.fingerprint.split(':').at(-1)) < cursor.length, 'Cursor occurrence exceeds row count');
        });
        const catalog = db.prepare(`SELECT scope, source, model_id AS modelId, name, provider, pool,
          input_usd_per_token AS input, cache_read_usd_per_token AS cacheRead,
          cache_write_usd_per_token AS cacheWrite, output_usd_per_token AS output,
          cache_read_fallback AS cacheReadFallback, cache_write_fallback AS cacheWriteFallback FROM model_prices ORDER BY id`).all();
        for (const row of catalog) {
          price(row);
          check(['default', 'cursor'].includes(row.scope) && ['builtin', 'litellm', 'cursor', 'user'].includes(row.source) &&
            typeof row.modelId === 'string' && typeof row.name === 'string' && nullableText(row.provider) && nullableText(row.pool) &&
            bit(row.cacheReadFallback) && bit(row.cacheWriteFallback), 'invalid price catalog');
        }
        const updates = db.prepare('SELECT * FROM price_updates').all();
        for (const row of updates) check(typeof row.source === 'string' && typeof row.state === 'string' &&
          nullableText(row.url) && (row.fetched_at === null || Number.isFinite(Date.parse(row.fetched_at))) &&
          Number.isFinite(Date.parse(row.checked_at)), 'invalid price update');
        return { meta, prices, catalog, updates, rows: mergeUsageRows(rows, canonical), cursor: selectCursorImports(cursor) };
      } finally { db.close(); }
    });
  } catch (err) {
    const error = new Error(`Invalid toksight database: ${err.message}`);
    error.status = 400; error.code = 'BAD_DATABASE';
    throw error;
  }
}
