// Portable identities use usage fields, never cost or machine-specific paths.
// Occurrence numbers preserve identical requests within a snapshot. Without
// source event IDs, changed timestamps/models/token counts are distinct usage.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { createPriceLookup } from './pricecatalog.js';

export function usageRows(rows) {
  const counts = new Map();
  return rows.map((row) => {
    const entry = row.entry ?? JSON.parse(row.data_json);
    const identity = createHash('sha256').update(JSON.stringify([
      entry.client, entry.sessionId, entry.timestamp, entry.model,
      entry.inputTokens, entry.outputTokens, entry.reasoningTokens,
      entry.cacheReadTokens, entry.cacheWriteTokens,
    ])).digest('hex');
    const occurrence = counts.get(identity) ?? 0;
    counts.set(identity, occurrence + 1);
    return { ...row, entry, fingerprint: `${identity}:${occurrence}` };
  });
}

export function mergeUsageRows(local, imported) {
  const merged = new Map(usageRows(local).map((row) => [row.fingerprint, row]));
  for (const row of imported) {
    const previous = merged.get(row.fingerprint);
    if (!previous || (!previous.reported_cost && row.reported_cost)) merged.set(row.fingerprint, row);
  }
  return [...merged.values()];
}

// CLI collection reads durable imports without creating or modifying a DB.
export function readUsageImports(file, warnings = []) {
  if (!existsSync(file)) return [];
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_imports'").get()) return [];
    return db.prepare('SELECT * FROM usage_imports ORDER BY rowid').all().map((row) => ({
      ...row, entry: JSON.parse(row.data_json), price: JSON.parse(row.price_json),
    }));
  } catch (err) {
    warnings.push(`toksight: cannot read imported usage (${err.message})`);
    return [];
  } finally { db?.close(); }
}

export function readStoredPriceFor(file, warnings = []) {
  if (!existsSync(file)) return () => null;
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const meta = tables.has('snapshot_meta') ? db.prepare('SELECT model_prices_json FROM snapshot_meta WHERE id = 1').get() : null;
    const prices = new Map(meta ? JSON.parse(meta.model_prices_json) : []);
    const catalog = tables.has('model_prices') ? db.prepare(`SELECT scope, source, model_id AS modelId, name, provider, pool,
      input_usd_per_token AS input, cache_read_usd_per_token AS cacheRead,
      cache_write_usd_per_token AS cacheWrite, output_usd_per_token AS output,
      cache_read_fallback AS cacheReadFallback, cache_write_fallback AS cacheWriteFallback FROM model_prices ORDER BY id`).all() : [];
    const lookup = createPriceLookup(catalog);
    return (model, client) => lookup(model, client) ?? prices.get(client === 'cursor' ? `cursor\u0000${model}` : model) ?? null;
  } catch (err) {
    warnings.push(`toksight: cannot read saved prices (${err.message})`);
    return () => null;
  } finally { db?.close(); }
}
