import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configDir } from './pricing.js';

// User-owned routing declarations, scoped by client and observed provider ID.
// Current agent configuration is never applied retroactively to old sessions.
export function readProviderBindings({ env, home } = {}, warnings = []) {
  let rows;
  try { rows = JSON.parse(readFileSync(path.join(configDir({ env, home }), 'providers.json'), 'utf8')); }
  catch (err) { if (err.code !== 'ENOENT') warnings.push(`providers.json unavailable (${err.message})`); return []; }
  const fields = ['client','providerId','provider','endpoint','model','since','until'];
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row) ||
    Object.keys(row).some((key) => !fields.includes(key)) || typeof row.client !== 'string' || typeof row.providerId !== 'string' ||
    !['openai','anthropic','google','openrouter'].includes(row.provider) ||
    ['endpoint','model'].some((key) => row[key] != null && typeof row[key] !== 'string') ||
    ['since','until'].some((key) => row[key] != null && (typeof row[key] !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(row[key]) || !Number.isFinite(Date.parse(row[key])))) ||
    (row.since && row.until && Date.parse(row.since) >= Date.parse(row.until)))) {
    warnings.push('providers.json must contain valid client/provider bindings with optional ISO time intervals'); return [];
  }
  return rows;
}

export function bindProvider(entry, rows) {
  if (Object.hasOwn(entry, 'pricingProvider') || Object.hasOwn(entry, 'providerEndpoint')) {
    const { pricingProvider, providerEndpoint, ...original } = entry;
    entry = original;
  }
  if (!rows.length) return entry;
  const matches = rows.filter((row) => row.client === entry.client && row.providerId === entry.providerId &&
    (!row.model || row.model === entry.model) && (!row.since || Number.isFinite(entry.timestamp) && entry.timestamp >= Date.parse(row.since)) &&
    (!row.until || Number.isFinite(entry.timestamp) && entry.timestamp < Date.parse(row.until)));
  const specific = matches.filter((row) => row.model), selected = specific.length ? specific : matches;
  if (selected.length !== 1) {
    const { pricingProvider, providerEndpoint, ...original } = entry;
    return original; // Overlapping declarations do not guess a billing channel.
  }
  return { ...entry, pricingProvider: selected[0].provider, ...(selected[0].endpoint ? { providerEndpoint:selected[0].endpoint } : { providerEndpoint:null }) };
}
