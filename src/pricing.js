import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { savedPriceSources } from './priceselection.js';
import { createPriceLookup, modelIdentity, priceRecord } from './pricecatalog.js';
import { normalizeLitellmPrice } from './contextpricing.js';
import { firstPartyProvider } from './firstparty.js';

export const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const PRICE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

export function configDir({ env = process.env, home = os.homedir() } = {}) {
  if (env.TOKSIGHT_CONFIG_DIR) return env.TOKSIGHT_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'toksight');
}

export function normalizeModelName(name) {
  return modelIdentity(name).id;
}

// User overrides are authored per MTok and converted to USD per token before
// being stored in lookup maps.
const perToken = (pricePerMTok) => ({
  input: pricePerMTok.input / 1e6,
  output: pricePerMTok.output / 1e6,
  cacheRead: pricePerMTok.cacheRead / 1e6,
  cacheWrite: pricePerMTok.cacheWrite / 1e6,
  source: pricePerMTok.source,
  cacheReadFallback: Boolean(pricePerMTok.cacheReadFallback),
  cacheWriteFallback: Boolean(pricePerMTok.cacheWriteFallback),
});

const recordsFromEntries = (entries) => entries.map(([name, price]) => priceRecord({ name, ...price })).filter(Boolean);

export function computeCost(entry, price) {
  if (entry.costUsd != null) return entry.costUsd;
  if (!price) return null;
  return (
    entry.inputTokens * price.input +
    entry.cacheReadTokens * price.cacheRead +
    entry.cacheWriteTokens * price.cacheWrite +
    entry.outputTokens * price.output +
    (price.official?.cacheWrite1h != null && entry.cacheWrite1hTokens > 0
      ? entry.cacheWrite1hTokens * (price.official.cacheWrite1h - price.cacheWrite) : 0)
  );
}

async function loadUserPricing(dir) {
  const file = path.join(dir, 'pricing.json');
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw)
    .filter(([, v]) => v && typeof v === 'object' && typeof v.input === 'number' && typeof v.output === 'number')
    .map(([key, v]) => [
      key,
      perToken({
        input: v.input,
        output: v.output,
        cacheRead: v.cacheRead ?? v.input,
        cacheWrite: v.cacheWrite ?? v.input,
        source: 'user',
        cacheReadFallback: v.cacheRead == null,
        cacheWriteFallback: v.cacheWrite == null,
      }),
    ]);
  return { records: recordsFromEntries(entries) };
}

async function loadLitellmPricing(cacheFile, { offline = false, force = false, now = Date.now, fetchImpl = fetch } = {}) {
  let cached = null;
  try {
    cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    if (!Number.isFinite(cached?.fetchedAt) || !cached?.data || typeof cached.data !== 'object' || Array.isArray(cached.data)) cached = null;
  } catch {
    cached = null;
  }

  const time = now();
  const fresh = cached && time >= cached.fetchedAt && time - cached.fetchedAt < PRICE_REFRESH_MS;
  if (!offline && (force || !fresh)) {
    try {
      const res = await fetchImpl(LITELLM_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid LiteLLM price map');
      const map = buildLitellmMap(data);
      if (!map?.records.length) throw new Error('LiteLLM price map contains no usable first-party chat prices');
      cached = { fetchedAt: time, data };
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify(cached)).catch(() => {});
    } catch (err) {
      if (cached) return { map: buildLitellmMap(cached.data), state: 'stale', fetchedAt: cached.fetchedAt, warning: err.message };
      return { map: null, state: `unavailable (${err.message})`, fetchedAt: null, warning: err.message };
    }
  }
  const state = offline ? (cached ? (fresh ? 'fresh' : 'stale (offline)') : 'skipped (offline)')
    : fresh && !force ? 'fresh' : 'refreshed';
  return { map: cached ? buildLitellmMap(cached.data) : null,
    state,
    fetchedAt: cached?.fetchedAt ?? null };
}

export function buildLitellmMap(data) {
  if (!data || typeof data !== 'object') return null;
  const entries = [];
  for (const [key, v] of Object.entries(data)) {
    if (!v || typeof v !== 'object') continue;
    if (v.mode !== 'chat' && v.mode !== 'responses') continue;
    const provider = firstPartyProvider(key, v.litellm_provider);
    if (!provider) continue;
    const rates = normalizeLitellmPrice(v);
    if (!rates) continue;
    entries.push([key, { ...rates, source: 'litellm', provider }]);
  }
  return { records: recordsFromEntries(entries) };
}

export async function getPricing({ offline = false, force = false, env, home, selectedSources, now = Date.now, fetchImpl = fetch } = {}) {
  const dir = configDir({ env, home });
  const warnings = [];

  const userMap = await loadUserPricing(dir);
  const enabled = selectedSources ?? savedPriceSources(path.join(dir, 'usage.sqlite'), warnings);
  const lite = enabled.includes('litellm')
    ? await loadLitellmPricing(path.join(dir, 'cache', 'litellm-pricing.json'), { offline, force, now, fetchImpl })
    : { map: null, state: 'disabled', fetchedAt: null };
  if (lite.warning) warnings.push(`LiteLLM pricing unavailable, using cached estimates: ${lite.warning}`);
  const records = [
    ...(lite.map?.records ?? []),
    ...(userMap?.records ?? []),
  ].filter(Boolean);
  const lookup = createPriceLookup(records);

  return {
    priceFor: lookup,
    records,
    warnings,
    sources: { user: Boolean(userMap), litellm: lite.state },
    sourceDetails: { litellm: { fetchedAt: lite.fetchedAt == null ? null : new Date(lite.fetchedAt).toISOString(), url: LITELLM_URL, state: lite.state } },
    configDir: dir,
  };
}
