// All price sources use the same USD-per-token record shape and resolver.
// `scope` is the billing application: Cursor never falls through to another
// application's price for a model with the same name.

import { createCursorModelResolver, cursorIdentityFor, cursorModelId } from './cursormodels.js';

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
  cacheRead, cacheWrite, cacheReadFallback = false, cacheWriteFallback = false, cursor = null }) {
  const modelId = scope === 'cursor' ? cursorModelId(name) : modelIdentity(name).id;
  if (!modelId || !Number.isFinite(input) || !Number.isFinite(output) ||
      !Number.isFinite(cacheRead) || !Number.isFinite(cacheWrite)) return null;
  return { scope, source, modelId, name, provider, pool, input, output, cacheRead, cacheWrite,
    cacheReadFallback: Boolean(cacheReadFallback), cacheWriteFallback: Boolean(cacheWriteFallback), ...(cursor ? { cursor } : {}) };
}

export function createPriceLookup(records) {
  const cursorFor = createCursorModelResolver(records ?? []);
  const exact = new Map(), suffix = new Map(), builtin = [];
  const ambiguous = new Set(), ambiguousSuffix = new Set();
  for (const record of records ?? []) {
    if (!record?.modelId || record.scope === 'cursor') continue;
    const key = `${record.scope}\0${record.modelId}`;
    if (record.source === 'builtin') { builtin.push(record); continue; }
    const old = exact.get(key);
    if (old && old.source === record.source && old.name !== record.name) ambiguous.add(key);
    else if (!old || PRIORITY[record.source] > PRIORITY[old.source]) {
      exact.set(key, record);
      if (old && PRIORITY[record.source] > PRIORITY[old.source]) ambiguous.delete(key);
    }
  }
  for (const key of ambiguous) exact.delete(key);
  for (const record of exact.values()) {
    if (record.scope !== 'default') continue;
    const slash = record.modelId.lastIndexOf('/');
    if (slash < 0) continue;
    const base = record.modelId.slice(slash + 1);
    if (ambiguousSuffix.has(base)) continue;
    const prior = suffix.get(base);
    if (!prior || PRIORITY[record.source] > PRIORITY[prior.source]) suffix.set(base, record);
    else if (PRIORITY[record.source] === PRIORITY[prior.source] && prior.modelId !== record.modelId) {
      suffix.delete(base); ambiguousSuffix.add(base);
    }
  }
  builtin.sort((a, b) => b.modelId.length - a.modelId.length);
  return (name, client = null, entry = null) => {
    if (client === 'cursor') return cursorFor(name, entry);
    const { id } = modelIdentity(name, client);
    if (!id) return null;
    const exactHit = exact.get(`default\0${id}`);
    const suffixHit = suffix.get(id);
    // A user override keyed as provider/model must beat a bare LiteLLM
    // match for that model. At equal priority, keep the exact match.
    if (exactHit && (!suffixHit || PRIORITY[exactHit.source] >= PRIORITY[suffixHit.source])) return exactHit;
    return suffixHit ?? builtin.find((record) => id.startsWith(record.modelId)) ?? null;
  };
}
