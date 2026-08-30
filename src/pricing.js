import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour, matching tokscale's freshness bar
const FETCH_TIMEOUT_MS = 4000;

// Built-in fallback prices, USD per million tokens (best-effort snapshot).
// LiteLLM data (fetched with a 1h disk cache) and a user overrides file take
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
  let n = String(name ?? '').toLowerCase().trim();
  n = n.replace(/^[a-z0-9_-]+:/, ''); // provider prefixes like "builtin:" / "anthropic:"
  n = n.replace(/:latest$/, '');
  n = n.replace(/[-_.]?20\d{6,8}$/, ''); // date-suffixed snapshots
  n = n.replace(/\s+/g, '');
  return n;
}

// Built-in prices are authored per MTok; LiteLLM and user overrides are
// converted to USD per token before being stored in lookup maps.
const perToken = (pricePerMTok) => ({
  input: pricePerMTok.input / 1e6,
  output: pricePerMTok.output / 1e6,
  cacheRead: pricePerMTok.cacheRead / 1e6,
  cacheWrite: pricePerMTok.cacheWrite / 1e6,
  source: pricePerMTok.source,
});

function builtinMap() {
  const rules = [...BUILTIN_RULES].sort((a, b) => b.match.length - a.match.length);
  return (model) => {
    const n = normalizeModelName(model);
    if (!n) return null;
    const rule = rules.find((r) => n.startsWith(r.match));
    if (!rule) return null;
    return perToken({ ...rule, source: 'builtin' });
  };
}

function buildExactMap(entries) {
  const map = new Map();
  for (const [key, price] of entries) {
    const normalized = normalizeModelName(key);
    if (!normalized) continue;
    const existing = map.get(normalized);
    if (!existing || key.length > (existing.keyLength ?? 0)) {
      map.set(normalized, { ...price, keyLength: key.length });
    }
  }
  return map;
}

function lookupExact(map, model) {
  if (!map) return null;
  const n = normalizeModelName(model);
  const hit = map.get(n);
  if (hit) return hit;
  // Provider-prefixed keys (e.g. "zhipuai/glm-5.3") also match bare names.
  let best = null;
  for (const [key, price] of map) {
    if (key.endsWith(`/${n}`) && (!best || key.length > best.keyLength)) {
      best = price;
    }
  }
  return best ?? null;
}

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
      }),
    ]);
  return buildExactMap(entries);
}

async function loadLitellmPricing(cacheFile) {
  let cached = null;
  try {
    cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
  } catch {
    cached = null;
  }

  const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (!fresh) {
    try {
      const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cached = { fetchedAt: Date.now(), data };
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify(cached)).catch(() => {});
    } catch (err) {
      if (cached) return { map: buildLitellmMap(cached.data), state: 'stale' };
      return { map: null, state: `unavailable (${err.message})` };
    }
  }
  return { map: buildLitellmMap(cached.data), state: fresh ? 'fresh' : 'refreshed' };
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
        cacheRead: v.cache_read_input_token_cost ?? v.input_cost_per_token,
        cacheWrite: v.cache_creation_input_token_cost ?? v.input_cost_per_token,
        source: 'litellm',
      },
    ]);
  }
  return buildExactMap(entries);
}

export async function getPricing({ offline = false, env, home } = {}) {
  const dir = configDir({ env, home });
  const warnings = [];

  const userMap = await loadUserPricing(dir);

  let litellmMap = null;
  let litellmState = 'skipped (offline)';
  if (!offline) {
    const { map, state } = await loadLitellmPricing(path.join(dir, 'cache', 'litellm-pricing.json'));
    litellmMap = map;
    litellmState = state;
    if (typeof state === 'string' && state.startsWith('unavailable')) {
      warnings.push(`LiteLLM pricing unavailable, using built-in estimates: ${state}`);
    }
  }

  const builtin = builtinMap();

  function priceFor(model) {
    const userHit = lookupExact(userMap, model);
    if (userHit) return userHit;
    const litellmHit = lookupExact(litellmMap, model);
    if (litellmHit) return litellmHit;
    return builtin(model);
  }

  return {
    priceFor,
    warnings,
    sources: { user: Boolean(userMap), litellm: litellmState, builtin: true },
    configDir: dir,
  };
}
