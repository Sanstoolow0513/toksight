import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPriceLookup, modelIdentity, priceRecord } from './pricecatalog.js';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const PRICE_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

// Built-in fallback prices, USD per million tokens (best-effort snapshot).
// LiteLLM data (fetched with a 7-day disk cache) and a user overrides file take
// precedence, in that order.
const BUILTIN_RULES = [
  { match: 'claude-opus-4', input: 15, cacheRead: 1.5, cacheWrite: 18.75, output: 75 },
  { match: 'claude-sonnet-4', input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 },
  { match: 'claude-haiku-4', input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 },
  { match: 'gpt-5-codex', input: 1.25, cacheRead: 0.125, cacheWrite: 0, output: 10 },
  { match: 'gpt-5-mini', input: 0.25, cacheRead: 0.025, cacheWrite: 0, output: 2 },
  { match: 'gpt-5', input: 1.25, cacheRead: 0.125, cacheWrite: 0, output: 10 },
  { match: 'gpt-4.1', input: 2, cacheRead: 0.5, cacheWrite: 0, output: 8 },
  { match: 'glm-5', input: 0.6, cacheRead: 0.11, cacheWrite: 0.6, output: 2.2 },
  { match: 'glm-4.6', input: 0.6, cacheRead: 0.11, cacheWrite: 0.6, output: 2.2 },
  { match: 'glm-4.5', input: 0.6, cacheRead: 0.11, cacheWrite: 0.6, output: 2.2 },
  { match: 'glm-4', input: 0.1, cacheRead: 0.02, cacheWrite: 0, output: 0.1 },
  { match: 'gemini-3-pro', input: 2, cacheRead: 0.2, cacheWrite: 0, output: 12 },
  { match: 'gemini-3-flash', input: 0.3, cacheRead: 0.03, cacheWrite: 0, output: 2.5 },
  { match: 'gemini-2.5-pro', input: 1.25, cacheRead: 0.31, cacheWrite: 0, output: 10 },
  { match: 'gemini-2.5-flash', input: 0.3, cacheRead: 0.075, cacheWrite: 0, output: 2.5 },
  { match: 'deepseek', input: 0.28, cacheRead: 0.028, cacheWrite: 0, output: 0.42 },
  { match: 'kimi', input: 0.6, cacheRead: 0.11, cacheWrite: 0.6, output: 2.5 },
  { match: 'qwen3-coder', input: 0.3, cacheRead: 0.03, cacheWrite: 0, output: 1.2 },
  { match: 'minimax', input: 0.4, cacheRead: 0.04, cacheWrite: 0, output: 1.6 },
];

export function configDir({ env = process.env, home = os.homedir() } = {}) {
  if (env.TOKSIGHT_CONFIG_DIR) return env.TOKSIGHT_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'toksight');
}

export function normalizeModelName(name) {
  return modelIdentity(name).id;
}

// Built-in prices are authored per MTok; LiteLLM and user overrides are
// converted to USD per token before being stored in lookup maps.
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
    entry.outputTokens * price.output
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

function buildLitellmMap(data) {
  if (!data || typeof data !== 'object') return null;
  const entries = [];
  for (const [key, v] of Object.entries(data)) {
    if (!v || typeof v !== 'object') continue;
    if (v.mode && v.mode !== 'chat' && v.mode !== 'responses') continue;
    if (typeof v.input_cost_per_token !== 'number' || typeof v.output_cost_per_token !== 'number') continue;
    entries.push([
      key,
      {
        input: v.input_cost_per_token,
        output: v.output_cost_per_token,
        // When LiteLLM lacks cache prices, fall back to the input price. This
        // is a deliberate conservative OVERestimate (cache reads are usually
        // ~10% of the input price) — costs are never silently undercounted,
        // and models with real cache prices price normally. Alternative
        // (treat the entry as unpriced) was rejected for now; a second
        // pricing source to fill the gap is tracked in AGENTS.md
        // ("Researched but not implemented" — models.dev).
        cacheRead: v.cache_read_input_token_cost ?? v.input_cost_per_token,
        cacheWrite: v.cache_creation_input_token_cost ?? v.input_cost_per_token,
        source: 'litellm',
        provider: v.litellm_provider ?? null,
        cacheReadFallback: v.cache_read_input_token_cost == null,
        cacheWriteFallback: v.cache_creation_input_token_cost == null,
      },
    ]);
  }
  return { records: recordsFromEntries(entries) };
}

export async function getPricing({ offline = false, force = false, env, home, now = Date.now, fetchImpl = fetch } = {}) {
  const dir = configDir({ env, home });
  const warnings = [];

  const userMap = await loadUserPricing(dir);
  const lite = await loadLitellmPricing(path.join(dir, 'cache', 'litellm-pricing.json'), { offline, force, now, fetchImpl });
  if (lite.warning) warnings.push(`LiteLLM pricing unavailable, using cached/built-in estimates: ${lite.warning}`);
  const records = [
    ...BUILTIN_RULES.map((rule) => priceRecord({ name: rule.match, ...perToken({ ...rule, source: 'builtin' }) })),
    ...(lite.map?.records ?? []),
    ...(userMap?.records ?? []),
  ].filter(Boolean);
  const lookup = createPriceLookup(records);

  return {
    priceFor: (model, client) => lookup(model, client),
    records,
    warnings,
    sources: { user: Boolean(userMap), litellm: lite.state, builtin: true },
    sourceDetails: { litellm: { fetchedAt: lite.fetchedAt == null ? null : new Date(lite.fetchedAt).toISOString(), url: LITELLM_URL, state: lite.state } },
    configDir: dir,
  };
}
