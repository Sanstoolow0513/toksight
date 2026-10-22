// LiteLLM first-party prices and user overrides share one USD/token resolver.

import { priceForContext, validContextTiers } from './contextpricing.js';
import { applyOfficialRules, validOfficialPrice } from './pricehistory.js';

import { NATIVE_CHANNELS, nativeChannel } from './nativeproviders.js';

const EFFORT = new Set(['low', 'medium', 'high', 'xhigh']);
const PRIORITY = { user: 2, litellm: 1 };
const storedLookups = new WeakMap();

export function modelIdentity(name, client = null, rate = null) {
  let id = String(name ?? '').trim().toLowerCase();
  id = id.replace(/^[a-z0-9_-]+:/, '').replace(/:latest$/, '')
    .replace(/[-_.]?20\d{6,8}$/, '').replace(/\s+/g, '');
  return { id, effort: null };
}

function displayIdentity(name) {
  let id = String(name ?? '').trim().toLowerCase();
  id = id.replace(/^[a-z][a-z0-9_-]*\//, '');
  id = id.replace(/\bfast mode\b/g, 'fast');
  id = id.replace(/(\d)[.-](\d)/g, '$1.$2');
  const rawParts = id.replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '').split('-').filter(Boolean);
  const parts = rawParts;
  const effortIndex = parts.at(-1) === 'fast' ? parts.length - 2 : parts.length - 1;
  const effort = EFFORT.has(parts[effortIndex]) ? parts[effortIndex] : null;
  const modelParts = [...parts];
  if (effort) modelParts.splice(effortIndex, 1);
  const modelId = modelParts[0] === 'claude' ? `claude:${modelParts.slice(1).sort().join('-')}` : modelParts.join('-');
  return { id: modelId, effort };
}

// Report names describe the underlying model without changing billing keys.
export function reportModelName(name, client = null, rate = null) {
  const raw = String(name ?? '').trim();
  const id = displayIdentity(modelIdentity(raw).id).id;
  const claude = /^claude:(\d+(?:\.\d+)*)-(opus|sonnet|haiku|fable)$/.exec(id);
  if (claude) return `Claude ${claude[2][0].toUpperCase()}${claude[2].slice(1)} ${claude[1]}`;
  const family = /^(gpt|grok|gemini|composer|glm)-(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(id);
  if (family) {
    const brand = { gpt: 'GPT', grok: 'Grok', gemini: 'Gemini', composer: 'Composer', glm: 'GLM' }[family[1]];
    const variants = family[3]?.split('-') ?? [];
    const fast = variants.at(-1) === 'fast';
    if (fast) variants.pop();
    const tail = variants.map((part) => part === '500k' ? part : `${part[0].toUpperCase()}${part.slice(1)}`).join(' ');
    const separator = family[1] === 'gpt' || family[1] === 'glm' ? '-' : ' ';
    return `${brand}${separator}${family[2]}${tail ? ` ${tail}` : ''}${fast ? ' (Fast)' : ''}`;
  }
  return raw;
}

export function priceRecord({ scope = 'default', source, name, provider = null, pool = null, input, output,
  cacheRead, cacheWrite, cacheReadFallback = false, cacheWriteFallback = false, contextTiers = null, official = null }) {
  if (scope !== 'default') return null;
  const modelId = modelIdentity(name).id;
  if (!modelId || !Number.isFinite(input) || !Number.isFinite(output) ||
      !Number.isFinite(cacheRead) || !Number.isFinite(cacheWrite) ||
      [input, output, cacheRead, cacheWrite].some((n) => n < 0) || !validContextTiers(contextTiers) || !validOfficialPrice(official)) return null;
  return { scope, source, modelId, name, provider, pool, input, output, cacheRead, cacheWrite,
    cacheReadFallback: Boolean(cacheReadFallback), cacheWriteFallback: Boolean(cacheWriteFallback),
    ...(contextTiers?.length ? { contextTiers } : {}), ...(official ? { official } : {}) };
}

// Keep billing keys separate from report identities. In particular, dated
// snapshots and fine-tuned models must retain their own exact catalog entry.
export const priceModelKey = (name) => String(name ?? '').trim().toLowerCase();
const priceAlias = (name) => priceModelKey(name).replace(/:latest$/, '')
  .replace(/[-_.]20\d{2}(?:-?\d{2}){2}$/, '').replace(/\s+/g, '');

// Stable Kimi Code endpoints use Moonshot API prices as reference estimates.
// Keep the provider explicit: other hosts can charge differently for K3.
// The rolling kimi-for-coding endpoint does not identify a historical model.
// https://www.kimi.com/code/docs/en/kimi-code/models.html
const KIMI_CODE_REFERENCE_MODELS = new Map([
  ['kimi-code/k3', 'moonshot/kimi-k3'],
  ['kimi-code/k3-256k', 'moonshot/kimi-k3'],
]);

function findPrice({ exact, aliases, normalized }, key, alias = priceAlias(key)) {
  const candidates = [exact.get(key), aliases.get(key), exact.get(alias), aliases.get(alias), normalized.get(alias)];
  const index = candidates.findIndex(Boolean);
  return index < 0 ? null : { record: candidates[index], priority: candidates.length - index };
}

export function storedPriceFor(model, record, entry = null) {
  // Saved per-model estimates obey the same namespace and provider rules as
  // the live catalog, including explicit Kimi Code reference aliases.
  if (record?.source === 'litellm') {
    if (!storedLookups.has(record)) storedLookups.set(record, createPriceLookup([record]));
    return storedLookups.get(record)(model, null, entry);
  }
  const rawProvider = entry?.pricingProvider ?? entry?.providerId;
  const provider = nativeChannel(rawProvider === 'kimi-code' && KIMI_CODE_REFERENCE_MODELS.has(priceModelKey(model)) ? 'moonshot' : rawProvider);
  if (record?.source !== 'user' && provider) {
    if (record?.official && record.official.channel !== nativeChannel(provider)) return null;
    if (record?.official?.channel === 'openrouter' && (record.official.endpoint ?? null) !== (entry.providerEndpoint ?? null)) return null;
    if (!record?.official && ![...NATIVE_CHANNELS, 'kimi-code'].includes(nativeChannel(provider))) return null;
  }
  return applyOfficialRules(priceForContext(record, entry), entry) ?? null;
}

function sameAliasPrice(a, b) {
  const sameName = priceAlias(a.name) === priceAlias(b.name) || Boolean(a.provider && b.provider &&
    priceAlias(a.name).split('/').at(-1) === priceAlias(b.name).split('/').at(-1));
  return sameName && nativeChannel(a.provider) === nativeChannel(b.provider) &&
    ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheReadFallback', 'cacheWriteFallback'].every((part) => a[part] === b[part]) &&
    JSON.stringify(a.contextTiers ?? []) === JSON.stringify(b.contextTiers ?? []);
}

function addAlias(index, key, record) {
  if (!index.has(key)) index.set(key, record);
  else if (index.get(key) && !sameAliasPrice(index.get(key), record)) index.set(key, null);
}

export function encodePriceMetadata(record) {
  return JSON.stringify(record.contextTiers?.length || record.official ? { ...(record.contextTiers?.length ? { contextTiers: record.contextTiers } : {}),
      ...(record.official ? { official: record.official } : {}) } : null);
}

export function decodePriceRecord({ metadataJson, ...record }) {
  // Retired scopes in old databases are filtered before lookup.
  if (record.scope !== 'default') return record;
  const metadata = JSON.parse(metadataJson ?? 'null');
  if (metadata != null && (typeof metadata !== 'object' || Array.isArray(metadata) || !validContextTiers(metadata.contextTiers) || !validOfficialPrice(metadata.official))) {
    throw new Error('invalid context price metadata');
  }
  return { ...record, ...(metadata?.contextTiers?.length ? { contextTiers: metadata.contextTiers } : {}), ...(metadata?.official ? { official: metadata.official } : {}) };
}

export function createPriceLookup(records) {
  const sources = new Map();
  for (const record of records ?? []) {
    if (!record?.name || record.scope !== 'default' || !Object.hasOwn(PRIORITY, record.source)) continue;
    const sourceKey = `${record.source}\0${nativeChannel(record.provider) ?? ''}`;
    if (!sources.has(sourceKey)) sources.set(sourceKey, { source: record.source, provider: record.provider, official: record.official, exact: new Map(), aliases: new Map(), normalized: new Map() });
    const { exact, aliases, normalized } = sources.get(sourceKey);
    const key = priceModelKey(record.name);
    addAlias(exact, key, record);
    addAlias(normalized, priceAlias(key), record);
    for (const alias of record.official?.aliases ?? []) addAlias(aliases, priceModelKey(alias), record);
    const slash = key.lastIndexOf('/');
    if (slash >= 0) {
      addAlias(aliases, key.slice(slash + 1), record);
      addAlias(normalized, priceAlias(key.slice(slash + 1)), record);
      if (record.provider) {
        addAlias(aliases, `${priceModelKey(record.provider)}/${key.slice(slash + 1)}`, record);
        addAlias(normalized, `${priceModelKey(record.provider)}/${priceAlias(key.slice(slash + 1))}`, record);
      }
    } else if (slash < 0 && record.provider) {
      // Only construct a provider-qualified alias from catalog metadata.
      addAlias(aliases, `${priceModelKey(record.provider)}/${key}`, record);
      addAlias(normalized, `${priceModelKey(record.provider)}/${priceAlias(key)}`, record);
    }
  }
  const ordered = [...sources.values()].sort((a, b) => PRIORITY[b.source] - PRIORITY[a.source]);
  return (name, client = null, entry = null) => {
    const routerPrefix = /^openrouter\//i.test(name);
    const key = priceModelKey(routerPrefix ? name.slice(11) : name), alias = priceAlias(key);
    if (!key) return null;
    const reference = KIMI_CODE_REFERENCE_MODELS.get(key);
    const matches = [];
    // Source priority comes first; within a source, exact names precede
    // normalized aliases. Ambiguous aliases never displace an exact entry.
    for (const index of ordered) {
      const rawProvider = entry?.pricingProvider ?? entry?.providerId;
      const provider = nativeChannel(rawProvider === 'kimi-code' && reference ? 'moonshot' : rawProvider);
      if (index.source !== 'user' && (routerPrefix || provider && provider !== nativeChannel(index.provider))) continue;
      const direct = findPrice(index, key, alias);
      const fallback = !direct && reference ? findPrice(index, reference) : null;
      const match = direct ?? (fallback ? { ...fallback, priority: 0 } : null);
      if (match && index.source === 'user') return applyOfficialRules(priceForContext(match.record, entry), entry);
      if (match) matches.push(match);
    }
    const priority = Math.max(...matches.map((match) => match.priority));
    const best = matches.filter((match) => match.priority === priority);
    return best.length === 1 ? applyOfficialRules(priceForContext(best[0].record, entry), entry) : null;
  };
}
