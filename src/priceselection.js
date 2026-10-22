// Preferences affect every lookup, including saved estimates and history.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { isFirstPartyPrice } from './firstparty.js';
export const PRICE_SOURCES = ['litellm'];
export const DEFAULT_PRICE_SOURCES = ['litellm'];
export const validPriceSources = (value) => Array.isArray(value) && value.length <= PRICE_SOURCES.length &&
  value.every((source) => PRICE_SOURCES.includes(source)) && new Set(value).size === value.length;
export const priceEnabled = (record, sources = DEFAULT_PRICE_SOURCES) => Boolean(record) &&
  (record.scope == null || record.scope === 'default') &&
  (record.source === 'user' || sources.includes(record.source) && record.source === 'litellm' &&
    (record.name == null && record.input == null || isFirstPartyPrice(record)));
export function readPriceSources(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'price_preferences'").get()) return [...DEFAULT_PRICE_SOURCES];
  const raw = db.prepare('SELECT sources_json FROM price_preferences WHERE id = 1').get();
  const sources = raw ? JSON.parse(raw.sources_json) : null;
  // Retired website/router selections migrate to the new first-party catalog.
  // An explicitly empty selection continues to disable downloaded estimates.
  return validPriceSources(sources) ? sources : [...DEFAULT_PRICE_SOURCES];
}
export function savedPriceSources(file, warnings = []) {
  if (!existsSync(file)) return [...DEFAULT_PRICE_SOURCES];
  let db;
  try { db = new DatabaseSync(file, { readOnly: true }); return readPriceSources(db); }
  catch (err) { warnings.push(`Cannot read price source preferences (${err.message}); using defaults`); return [...DEFAULT_PRICE_SOURCES]; }
  finally { db?.close(); }
}
