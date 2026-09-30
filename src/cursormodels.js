// Cursor model names come from the downloaded catalog. These are syntax and
// execution-mode rules, not a list of model families, versions, or exceptions.
const EFFORT = new Set(['low', 'medium', 'high', 'xhigh']);
const MODES = new Set([...EFFORT, 'max', 'thinking']);

export function cursorModelTokens(name) {
  return String(name ?? '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9_-]*\//, '').replace(/^cursor[-:]/, '')
    .replace(/\bfast mode\b/g, 'fast')
    .replace(/(\d)[.-](?=\d+(?:[._\s/-]|$))/g, '$1.')
    .replace(/([a-z])(?=\d)/g, '$1-')
    .replace(/[^a-z0-9.]+/g, '-').split('-').filter(Boolean);
}

export const cursorModelId = (name) => cursorModelTokens(name).join('-');
export const cursorModelSignature = (name) => cursorModelTokens(name).sort().join('|');

function aliases(record) {
  const full = [record.name, ...(record.cursor?.aliases ?? [])].map(cursorModelTokens);
  // CSVs can omit the leading brand (e.g. "opus5.5"). Only accept such a
  // shorthand if it includes a version and resolves uniquely in the catalog.
  return full.flatMap((parts) => parts.length >= 3 && parts.slice(1).some((p) => /^\d/.test(p))
    ? [{ parts, short: false }, { parts: parts.slice(1), short: true }] : [{ parts, short: false }]);
}

function match(parts, alias) {
  const remaining = [...parts];
  for (const part of alias) {
    const i = remaining.indexOf(part);
    if (i < 0) return null;
    remaining.splice(i, 1);
  }
  return remaining.every((part) => MODES.has(part)) ? remaining : null;
}

export function cursorIdentityFor(name, record = null) {
  const parts = cursorModelTokens(name);
  let remaining = [];
  if (record) {
    for (const alias of aliases(record).sort((a, b) => b.parts.length - a.parts.length)) {
      const result = match(parts, alias.parts);
      if (result) { remaining = result; break; }
    }
  }
  return { id: record?.modelId ?? cursorModelId(name),
    effort: remaining.find((part) => EFFORT.has(part)) ?? null,
    ...(remaining.includes('max') ? { maxMode: true } : {}) };
}

export function createCursorModelResolver(records) {
  const candidates = records.filter((record) => record.scope === 'cursor')
    .flatMap((record) => aliases(record).map(({ parts, short }) => ({ record, alias: parts, weight: parts.length * 2 + (short ? 0 : 1) })));
  const cache = new Map();
  return (name, entry = null) => {
    let hits = cache.get(name);
    if (!hits) {
      const parts = cursorModelTokens(name);
      let score = -1;
      hits = new Set();
      for (const { record, alias, weight } of candidates) {
        if (!alias.length || weight < score || !match(parts, alias)) continue;
        if (weight > score) { score = weight; hits.clear(); }
        hits.add(record);
      }
      cache.set(name, hits);
    }
    const input = entry ? entry.inputTokens + entry.cacheReadTokens + entry.cacheWriteTokens : 0;
    let tier = -1, selected = null, ambiguous = false;
    for (const record of hits) {
      const over = record.cursor?.contextOver ?? -1;
      if (over >= 0 && !(input > over)) continue;
      if (over > tier || !selected) { tier = over; selected = record; ambiguous = false; }
      else if (over === tier && record !== selected) ambiguous = true;
    }
    return ambiguous ? null : selected;
  };
}

export function validCursorMetadata(value) {
  return value == null || (typeof value === 'object' && !Array.isArray(value) &&
    (!('aliases' in value) || Array.isArray(value.aliases) && value.aliases.every((v) => typeof v === 'string' && v.length > 0)) &&
    (value.contextOver == null || Number.isSafeInteger(value.contextOver) && value.contextOver >= 0) &&
    (value.url == null || typeof value.url === 'string' && /^https:\/\/cursor\.com\/docs\//.test(value.url)) &&
    (value.fetchedAt == null || Number.isFinite(Date.parse(value.fetchedAt))) &&
    (value.retained == null || typeof value.retained === 'boolean'));
}

export function decodeCursorPrice(row) {
  const { cursorJson, ...record } = row;
  const cursor = JSON.parse(cursorJson ?? 'null');
  if (!validCursorMetadata(cursor)) throw new Error('invalid Cursor price metadata');
  return { ...record, ...(cursor ? { cursor } : {}) };
}
