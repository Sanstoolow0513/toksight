// All price sources use the same USD-per-token record shape and resolver.
// `scope` is the billing application: Cursor never falls through to another
// application's price for a model with the same name.

const EFFORT = new Set(['low', 'medium', 'high', 'xhigh']);
const PRIORITY = { user: 3, litellm: 2, builtin: 1, cursor: 1 };

export function modelIdentity(name, client = null) {
  let id = String(name ?? '').trim().toLowerCase();
  if (client === 'cursor') {
    id = id.replace(/^[a-z][a-z0-9_-]*\//, '').replace(/^cursor[-:]/, '');
    id = id.replace(/\bfast mode\b/g, 'fast');
    id = id.replace(/(\d)[.-](\d)/g, '$1.$2');
    const rawParts = id.replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '').split('-').filter(Boolean);
    // Cursor's Claude CSV appends "thinking" as an execution mode; the
    // published table lists one token rate for the underlying Claude model.
    const parts = rawParts[0] === 'claude' ? rawParts.filter((part) => part !== 'thinking') : rawParts;
    const effortIndex = parts.at(-1) === 'fast' ? parts.length - 2 : parts.length - 1;
    const effort = EFFORT.has(parts[effortIndex]) ? parts[effortIndex] : null;
    const modelParts = [...parts];
    if (effort) modelParts.splice(effortIndex, 1);
    if (modelParts[0] === 'claude') return { id: `claude:${modelParts.slice(1).sort().join('-')}`, effort };
    return { id: modelParts.join('-'), effort };
  }
  id = id.replace(/^[a-z0-9_-]+:/, '').replace(/:latest$/, '')
    .replace(/[-_.]?20\d{6,8}$/, '').replace(/\s+/g, '');
  return { id, effort: null };
}

export function priceRecord({ scope = 'default', source, name, provider = null, pool = null, input, output,
  cacheRead, cacheWrite, cacheReadFallback = false, cacheWriteFallback = false }) {
  const modelId = modelIdentity(name, scope === 'cursor' ? 'cursor' : null).id;
  if (!modelId || !Number.isFinite(input) || !Number.isFinite(output) ||
      !Number.isFinite(cacheRead) || !Number.isFinite(cacheWrite)) return null;
  return { scope, source, modelId, name, provider, pool, input, output, cacheRead, cacheWrite,
    cacheReadFallback: Boolean(cacheReadFallback), cacheWriteFallback: Boolean(cacheWriteFallback) };
}

export function createPriceLookup(records) {
  const exact = new Map(), suffix = new Map(), builtin = [];
  const ambiguous = new Set(), ambiguousSuffix = new Set();
  for (const record of records ?? []) {
    if (!record?.modelId) continue;
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
    if (exact.has(`default\0${base}`)) continue;
    if (ambiguousSuffix.has(base)) continue;
    const prior = suffix.get(base);
    if (!prior || PRIORITY[record.source] > PRIORITY[prior.source]) suffix.set(base, record);
    else if (PRIORITY[record.source] === PRIORITY[prior.source] && prior.modelId !== record.modelId) {
      suffix.delete(base); ambiguousSuffix.add(base);
    }
  }
  builtin.sort((a, b) => b.modelId.length - a.modelId.length);
  return (name, client = null) => {
    const scope = client === 'cursor' ? 'cursor' : 'default';
    const { id } = modelIdentity(name, client);
    if (!id || (scope === 'cursor' && id === 'auto')) return null;
    const exactHit = exact.get(`${scope}\0${id}`);
    if (exactHit) return exactHit;
    if (scope === 'cursor') return null;
    return suffix.get(id) ?? builtin.find((record) => id.startsWith(record.modelId)) ?? null;
  };
}
