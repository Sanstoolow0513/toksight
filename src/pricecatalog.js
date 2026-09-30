// All price sources use the same USD-per-token record shape and resolver.
// `scope` is the billing application: Cursor never falls through to another
// application's price for a model with the same name.

import { createCursorModelResolver, cursorIdentityFor, cursorModelId, decodeCursorPrice } from './cursormodels.js';
import { priceForContext, validContextTiers } from './contextpricing.js';

const EFFORT = new Set(['low', 'medium', 'high', 'xhigh']);
const PRIORITY = { user: 3, litellm: 2, builtin: 1, cursor: 1 };

export function modelIdentity(name, client = null, rate = null) {
  if (client === 'cursor') return cursorIdentityFor(name, rate);
  let id = String(name ?? '').trim().toLowerCase();
  id = id.replace(/^[a-z0-9_-]+:/, '').replace(/:latest$/, '')
    .replace(/[-_.]?20\d{6,8}$/, '').replace(/\s+/g, '');
  return { id, effort: null };
}

// Existing non-Cursor report formatting is independent of Cursor's catalog.
function displayIdentity(name) {
  let id = String(name ?? '').trim().toLowerCase();
  id = id.replace(/^[a-z][a-z0-9_-]*\//, '').replace(/^cursor[-:]/, '');
  id = id.replace(/\bfast mode\b/g, 'fast');
  id = id.replace(/(\d)[.-](\d)/g, '$1.$2');
  const rawParts = id.replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '').split('-').filter(Boolean);
  // Usage Events also exports Claude shorthand such as "opus5.5-high".
  // Expand it before rate lookup so it matches the official "Claude Opus 5.5"
  // row. The original CSV model remains untouched for import deduplication.
  const shorthand = rawParts[0] === 'claude' ? 1 : 0;
  const compact = /^(opus|sonnet|haiku|fable)(\d+(?:\.\d+)*)$/.exec(rawParts[shorthand] ?? '');
  if (compact) rawParts.splice(shorthand, 1, compact[1], compact[2]);
  if (shorthand === 0 && /^(opus|sonnet|haiku|fable)$/.test(rawParts[0] ?? '') && /^\d+(?:\.\d+)*$/.test(rawParts[1] ?? '')) {
    rawParts.unshift('claude');
  }
  // Cursor's Claude CSV appends "thinking" as an execution mode; the
  // published table lists one token rate for the underlying Claude model.
  const withoutThinking = rawParts[0] === 'claude' ? rawParts.filter((part) => part !== 'thinking') : rawParts;
  const parts = withoutThinking;
  const effortIndex = parts.at(-1) === 'fast' ? parts.length - 2 : parts.length - 1;
  const effort = EFFORT.has(parts[effortIndex]) ? parts[effortIndex] : null;
  const modelParts = [...parts];
  if (effort) modelParts.splice(effortIndex, 1);
  const modelId = modelParts[0] === 'claude' ? `claude:${modelParts.slice(1).sort().join('-')}` : modelParts.join('-');
  return { id: modelId, effort };
}

// Report names describe the underlying model, while modelIdentity above
// remains the reference-price key. Cursor effort/thinking/max are execution modes;
// Fast and 500k are priced variants and stay visible as separate names.
export function reportModelName(name, client = null, rate = null) {
  const raw = String(name ?? '').trim();
  if (client === 'cursor') return rate?.scope === 'cursor' && rate.name ? rate.name : /^auto$/i.test(raw) ? 'Auto' : raw;
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
  cacheRead, cacheWrite, cacheReadFallback = false, cacheWriteFallback = false, cursor = null, contextTiers = null }) {
  const modelId = scope === 'cursor' ? cursorModelId(name) : modelIdentity(name).id;
  if (!modelId || !Number.isFinite(input) || !Number.isFinite(output) ||
      !Number.isFinite(cacheRead) || !Number.isFinite(cacheWrite) || !validContextTiers(contextTiers)) return null;
  return { scope, source, modelId, name, provider, pool, input, output, cacheRead, cacheWrite,
    cacheReadFallback: Boolean(cacheReadFallback), cacheWriteFallback: Boolean(cacheWriteFallback), ...(cursor ? { cursor } : {}),
    ...(contextTiers?.length ? { contextTiers } : {}) };
}

// Keep billing keys separate from report identities. In particular, dated
// snapshots and fine-tuned models must retain their own exact catalog entry.
export const priceModelKey = (name) => String(name ?? '').trim().toLowerCase();
const priceAlias = (name) => priceModelKey(name).replace(/^builtin:/, '').replace(/:latest$/, '')
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
  return exact.get(key) ?? aliases.get(key) ?? exact.get(alias) ?? aliases.get(alias) ?? normalized.get(alias);
}

export function storedPriceFor(model, record, entry = null) {
  // Old snapshots may contain a family-prefix estimate for a newer variant.
  // Reusing that estimate would bypass the stricter catalog matching below.
  if (record?.source === 'builtin' && record.name && priceAlias(model) !== priceAlias(record.name)) return null;
  return priceForContext(record, entry) ?? null;
}

function sameAliasPrice(a, b) {
  return priceAlias(a.name) === priceAlias(b.name) && a.provider === b.provider &&
    ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheReadFallback', 'cacheWriteFallback'].every((part) => a[part] === b[part]) &&
    JSON.stringify(a.contextTiers ?? []) === JSON.stringify(b.contextTiers ?? []);
}

function addAlias(index, key, record) {
  if (!index.has(key)) index.set(key, record);
  else if (index.get(key) && !sameAliasPrice(index.get(key), record)) index.set(key, null);
}

export function encodePriceMetadata(record) {
  return JSON.stringify(record.scope === 'cursor' ? record.cursor ?? null
    : record.contextTiers?.length ? { contextTiers: record.contextTiers } : null);
}

export function decodePriceRecord({ metadataJson, ...record }) {
  if (record.scope === 'cursor') return decodeCursorPrice({ ...record, cursorJson: metadataJson });
  const metadata = JSON.parse(metadataJson ?? 'null');
  if (metadata != null && (typeof metadata !== 'object' || Array.isArray(metadata) || !validContextTiers(metadata.contextTiers))) {
    throw new Error('invalid context price metadata');
  }
  return { ...record, ...(metadata?.contextTiers?.length ? { contextTiers: metadata.contextTiers } : {}) };
}

export function createPriceLookup(records) {
  const cursorFor = createCursorModelResolver(records ?? []);
  const sources = new Map();
  for (const record of records ?? []) {
    if (!record?.name || record.scope !== 'default') continue;
    if (!sources.has(record.source)) sources.set(record.source, { exact: new Map(), aliases: new Map(), normalized: new Map() });
    const { exact, aliases, normalized } = sources.get(record.source);
    const key = priceModelKey(record.name);
    addAlias(exact, key, record);
    addAlias(normalized, priceAlias(key), record);
    const slash = key.lastIndexOf('/');
    if (record.source !== 'builtin' && slash >= 0) {
      addAlias(aliases, key.slice(slash + 1), record);
      addAlias(normalized, priceAlias(key.slice(slash + 1)), record);
    } else if (slash < 0 && record.provider) {
      // Only construct a provider-qualified alias from catalog metadata.
      addAlias(aliases, `${priceModelKey(record.provider)}/${key}`, record);
      addAlias(normalized, `${priceModelKey(record.provider)}/${priceAlias(key)}`, record);
    }
  }
  const ordered = [...sources].sort(([a], [b]) => PRIORITY[b] - PRIORITY[a]).map(([, index]) => index);
  return (name, client = null, entry = null) => {
    if (client === 'cursor') return cursorFor(name, entry);
    const key = priceModelKey(name), alias = priceAlias(name);
    if (!key) return null;
    const reference = KIMI_CODE_REFERENCE_MODELS.get(key);
    // Source priority comes first; within a source, exact names precede
    // normalized aliases. Ambiguous aliases never displace an exact entry.
    for (const index of ordered) {
      const record = findPrice(index, key, alias) ?? (reference ? findPrice(index, reference) : null);
      if (record) return priceForContext(record, entry);
    }
    return null;
  };
}
