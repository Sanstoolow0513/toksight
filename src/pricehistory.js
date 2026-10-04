import { NATIVE_CHANNELS } from './nativeproviders.js';
import { createPriceLookup, priceModelKey } from './pricecatalog.js';

const parts = ['input', 'output', 'cacheRead', 'cacheWrite'];
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const clock = (n) => Number.isInteger(n) && n >= 0 && n <= 2359 && n % 100 < 60;
export function validOfficialPrice(value) {
  return value == null || (value && typeof value === 'object' && !Array.isArray(value) &&
    [...NATIVE_CHANNELS, 'openrouter'].includes(value.channel) &&
    (value.routerModel == null || typeof value.routerModel === 'string') &&
    (value.providerName == null || typeof value.providerName === 'string') &&
    (value.routerEndpoints == null || Array.isArray(value.routerEndpoints) && value.routerEndpoints.every((s) => typeof s === 'string')) &&
    (value.url == null || typeof value.url === 'string') &&
    (value.endpoint == null || typeof value.endpoint === 'string') &&
    (value.aliases == null || Array.isArray(value.aliases) && value.aliases.every((a) => typeof a === 'string')) &&
    (value.cacheWrite1h == null || Number.isFinite(value.cacheWrite1h) && value.cacheWrite1h >= 0) &&
    (value.rules == null || Array.isArray(value.rules) && value.rules.every((r) => r &&
      parts.every((part) => r[part] == null || Number.isFinite(r[part]) && r[part] >= 0) &&
      ['cacheReadFallback','cacheWriteFallback'].every((key) => r[key] == null || typeof r[key] === 'boolean') &&
      (r.contextOver == null || Number.isSafeInteger(r.contextOver) && r.contextOver >= 0) &&
      (r.utcStart == null || clock(r.utcStart)) && (r.utcEnd == null || clock(r.utcEnd)) &&
      ((r.utcStart == null) === (r.utcEnd == null)) &&
      (r.utcDays == null || Array.isArray(r.utcDays) && r.utcDays.length > 0 && r.utcDays.every((d) => weekdays.includes(d))))));
}

export function applyOfficialRules(record, entry) {
  if (!entry || !record?.official) return record;
  const context = entry.inputTokens + entry.cacheReadTokens + entry.cacheWriteTokens;
  const date = Number.isFinite(entry.timestamp) ? new Date(entry.timestamp) : null;
  const time = date ? date.getUTCHours() * 100 + date.getUTCMinutes() : null;
  let result = record;
  for (const rule of record.official.rules ?? []) {
    if (rule.contextOver != null && !(context > rule.contextOver)) continue;
    if (rule.utcDays && (!date || !rule.utcDays.includes(weekdays[date.getUTCDay()]))) continue;
    if (rule.utcStart != null) {
      if (time == null) continue;
      const inside = rule.utcStart <= rule.utcEnd ? time >= rule.utcStart && time < rule.utcEnd : time >= rule.utcStart || time < rule.utcEnd;
      if (!inside) continue;
    }
    result = { ...result, ...Object.fromEntries(parts.filter((part) => rule[part] != null).map((part) => [part, rule[part]])),
      ...(rule.cacheReadFallback != null ? { cacheReadFallback: rule.cacheReadFallback } : {}),
      ...(rule.cacheWriteFallback != null ? { cacheWriteFallback: rule.cacheWriteFallback } : {}) };
  }
  return result;
}

export const historyPriceKey = (row) => JSON.stringify([row.scope, row.source, priceModelKey(row.name), row.cursor?.contextOver ?? null]);
export function priceSignature(record) {
  // Fetch timestamps, labels and retained flags never create a rate revision.
  const { cursor, official, ...rest } = record;
  const { retained, ...officialRules } = official ?? {};
  return JSON.stringify({ ...rest, ...(official ? { official: officialRules } : {}), ...(cursor ? { cursor: { aliases: cursor.aliases, contextOver: cursor.contextOver, url: cursor.url } } : {}) });
}

export function createHistoricalPriceLookup(history, catalog) {
  if (!history?.length) return createPriceLookup(catalog);
  const groups = new Map();
  for (const row of history) {
    const record = JSON.parse(row.record_json), key = historyPriceKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ time: Date.parse(row.observed_at), record });
  }
  for (const rows of groups.values()) rows.sort((a, b) => a.time - b.time);
  const boundaries = [...new Set(history.map((r) => Date.parse(r.observed_at)))].sort((a,b) => a-b);
  const lookups = new Map();
  const current = createPriceLookup(catalog);
  return (model, client, entry = null) => {
    if (!Number.isFinite(entry?.timestamp)) return current(model, client, entry);
    let lo = 0, hi = boundaries.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (boundaries[mid] <= entry.timestamp) lo = mid + 1; else hi = mid; }
    if (!lookups.has(lo)) {
      const records = [...groups.values()].map((rows) => {
        // Older usage uses the earliest locally observed rate as a reference.
        let selected = rows[0];
        for (const row of rows) { if (row.time > entry.timestamp) break; selected = row; }
        return selected.record;
      });
      const keys = new Set(records.map(historyPriceKey));
      for (const row of catalog) if (!keys.has(historyPriceKey(row))) records.push(row);
      lookups.set(lo, createPriceLookup(records));
    }
    return lookups.get(lo)(model, client, entry);
  };
}
