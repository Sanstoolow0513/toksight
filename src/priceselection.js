// Preferences affect every lookup, including saved estimates and history.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
export const PRICE_SOURCES = ['openai', 'anthropic', 'google', 'deepseek', 'moonshot', 'zai', 'qwen', 'openrouter-native', 'cursor', 'openrouter', 'litellm'];
export const DEFAULT_PRICE_SOURCES = ['openai', 'anthropic', 'google', 'deepseek', 'moonshot', 'zai', 'qwen', 'openrouter-native', 'cursor'];
export const validPriceSources = (value) => Array.isArray(value) && value.length <= PRICE_SOURCES.length &&
  value.every((source) => PRICE_SOURCES.includes(source)) && new Set(value).size === value.length;
export const priceEnabled = (record, sources = DEFAULT_PRICE_SOURCES) => Boolean(record) &&
  (record.source === 'user' || sources.includes(record.source));
export function readPriceSources(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'price_preferences'").get()) return [...DEFAULT_PRICE_SOURCES];
  const raw = db.prepare('SELECT sources_json FROM price_preferences WHERE id = 1').get();
  const sources = raw ? JSON.parse(raw.sources_json) : null;
  return validPriceSources(sources) ? sources : [...DEFAULT_PRICE_SOURCES];
}
export function savedPriceSources(file, warnings = []) {
  if (!existsSync(file)) return [...DEFAULT_PRICE_SOURCES];
  let db;
  try { db = new DatabaseSync(file, { readOnly: true }); return readPriceSources(db); }
  catch (err) { warnings.push(`Cannot read price source preferences (${err.message}); using defaults`); return [...DEFAULT_PRICE_SOURCES]; }
  finally { db?.close(); }
}
