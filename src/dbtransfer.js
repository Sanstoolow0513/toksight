// Backups are standalone SQLite files. Import reads only known tables from an
// isolated, read-only copy; no SQL from the uploaded schema runs in the live DB.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mergeUsageRows, usageRows } from './usageimports.js';
import { decodePriceRecord } from './pricecatalog.js';
import { validContextTiers } from './contextpricing.js';
import { historyPriceKey, priceSignature, validOfficialPrice } from './pricehistory.js';
import { PRICE_SOURCES, priceEnabled } from './priceselection.js';

export const MAX_DATABASE_BYTES = 256 * 1024 * 1024;
const HEADER = Buffer.from('SQLite format 3\0');
const CLIENTS = new Set(['claude', 'codex', 'opencode', 'zcode', 'kimi']);
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
  if (value) check(validContextTiers(value.contextTiers), 'invalid context price metadata');
  if (value) check(validOfficialPrice(value.official), 'invalid official price metadata');
  return value;
}
function record(row) {
  const entry = JSON.parse(row.data_json);
  const allowedFields = [...fields, 'providerId', 'pricingProvider', 'providerEndpoint', 'cacheWrite1hTokens'];
  for (const key of ['providerId', 'pricingProvider', 'providerEndpoint']) if (Object.hasOwn(entry, key)) check(nullableText(entry[key]), 'invalid provider');
  if (Object.hasOwn(entry, 'cacheWrite1hTokens')) check(Number.isSafeInteger(entry.cacheWrite1hTokens) && entry.cacheWrite1hTokens >= 0 && entry.cacheWrite1hTokens <= entry.cacheWriteTokens, 'invalid cache duration token count');
  check(object(entry) && fields.every((field) => Object.hasOwn(entry, field)) &&
    Object.keys(entry).every((field) => allowedFields.includes(field)), 'invalid usage record');
  check(CLIENTS.has(entry.client), 'invalid agent');
  check(typeof entry.model === 'string' && nullableText(entry.sessionId) && nullableText(entry.title) && nullableText(entry.directory), 'invalid usage text');
  check(entry.timestamp === null || (Number.isSafeInteger(entry.timestamp) && Math.abs(entry.timestamp) <= 8640000000000000), 'invalid timestamp');
  check(tokenFields.every((key) => Number.isSafeInteger(entry[key]) && entry[key] >= 0), 'invalid token count');
  check(entry.costUsd === null || nonnegative(entry.costUsd), 'invalid cost');
  check(bit(row.reported_cost) && (!row.reported_cost || entry.costUsd !== null), 'invalid cost provenance');
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
        for (const name of ['snapshot_meta', 'entries', 'model_prices', 'price_updates']) {
          check(tables.has(name), `missing toksight table ${name}`);
        }
        check(db.prepare('PRAGMA quick_check').get().quick_check === 'ok', 'database integrity check failed');
        const metas = db.prepare('SELECT * FROM snapshot_meta').all();
        check(metas.length === 1 && metas[0].schema_version === 1 && metas[0].id === 1, 'unsupported toksight database version or missing snapshot');
        const meta = metas[0];
        check(Number.isFinite(Date.parse(meta.refreshed_at)), 'invalid snapshot date');
        const warnings = JSON.parse(meta.warnings_json), sources = JSON.parse(meta.pricing_sources_json);
        check(Array.isArray(warnings) && warnings.every((s) => typeof s === 'string') && object(sources), 'invalid snapshot metadata');
        let prices = JSON.parse(meta.model_prices_json);
        check(Array.isArray(prices) && prices.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string'), 'invalid prices');
        prices = prices.filter(([key, rate]) => !key.startsWith('cursor\u0000') && priceEnabled(rate, PRICE_SOURCES));
        prices.forEach((p) => price(p[1]));
        const storedRows = db.prepare('SELECT * FROM entries ORDER BY seq').all();
        check(storedRows.length === meta.entry_count, 'incomplete snapshot');
        // Retired clients and price sources are deliberately ignored, including
        // their old metadata. Existing source tables are never executed.
        const rows = storedRows.filter((row) => JSON.parse(row.data_json).client !== 'cursor');
        rows.forEach((row) => { const r = record(row); check(r.entry.client === row.client && r.entry.timestamp === row.timestamp, 'inconsistent usage index'); });
        const imports = tables.has('usage_imports') ? db.prepare('SELECT * FROM usage_imports ORDER BY rowid').all().filter((row) => JSON.parse(row.data_json).client !== 'cursor').map((row) => {
          const r = record(row);
          const rate = JSON.parse(row.price_json);
          r.price = priceEnabled(rate, PRICE_SOURCES) ? price(rate) : null;
          r.price_json = JSON.stringify(r.price);
          return r;
        }) : [];
        // Recompute identities from data instead of trusting uploaded hashes.
        const canonical = usageRows(imports);
        canonical.forEach((row, i) => check(row.fingerprint === imports[i].fingerprint, 'invalid imported usage identity'));
        const hasMetadata = db.prepare('PRAGMA table_info(model_prices)').all().some((c) => c.name === 'metadata_json');
        const catalog = db.prepare(`SELECT scope, source, model_id AS modelId, name, provider, pool,
          input_usd_per_token AS input, cache_read_usd_per_token AS cacheRead,
          cache_write_usd_per_token AS cacheWrite, output_usd_per_token AS output,
          cache_read_fallback AS cacheReadFallback, cache_write_fallback AS cacheWriteFallback,
          ${hasMetadata ? 'metadata_json' : "'null'"} AS metadataJson FROM model_prices ORDER BY id`).all().filter((row) => row.scope === 'default' && priceEnabled(row, PRICE_SOURCES)).map(decodePriceRecord);
        for (const row of catalog) {
          price(row);
          check(row.scope === 'default' && priceEnabled(row, PRICE_SOURCES) &&
            typeof row.modelId === 'string' && typeof row.name === 'string' && nullableText(row.provider) && nullableText(row.pool) &&
            bit(row.cacheReadFallback) && bit(row.cacheWriteFallback), 'invalid price catalog');
        }
        const updates = db.prepare('SELECT * FROM price_updates').all().filter((row) => PRICE_SOURCES.includes(row.source));
        for (const row of updates) check(typeof row.source === 'string' && typeof row.state === 'string' &&
          nullableText(row.url) && (row.fetched_at === null || Number.isFinite(Date.parse(row.fetched_at))) &&
          Number.isFinite(Date.parse(row.checked_at)), 'invalid price update');
        const history = tables.has('price_history') ? db.prepare('SELECT * FROM price_history').all().filter((row) => priceEnabled(JSON.parse(row.record_json), PRICE_SOURCES)) : [];
        for (const row of history) {
          const record = JSON.parse(row.record_json);
          price(record);
          check(record.scope === 'default' && priceEnabled(record, PRICE_SOURCES) &&
            typeof record.name === 'string' && typeof record.modelId === 'string' && nullableText(record.provider) && nullableText(record.pool) &&
            typeof record.cacheReadFallback === 'boolean' && typeof record.cacheWriteFallback === 'boolean' &&
            Number.isFinite(Date.parse(row.observed_at)) && row.observed_at === new Date(row.observed_at).toISOString() &&
            row.price_key === historyPriceKey(record) && row.signature === priceSignature(record), 'invalid price history');
        }
        return { meta, prices, catalog, updates, history, rows: mergeUsageRows(rows, canonical) };
      } finally { db.close(); }
    });
  } catch (err) {
    const error = new Error(`Invalid toksight database: ${err.message}`);
    error.status = 400; error.code = 'BAD_DATABASE';
    throw error;
  }
}
