// The price page shows one row per model. LiteLLM lists the same first-party
// model under several catalog IDs (provider prefixes such as dashscope/ and
// qwen_ai_platform/, or dated snapshots beside the undated name). Rows merge
// only when the source, provider channel, base name and every rate agree, so
// billing keys and per-request cost selection are untouched.

import { nativeChannel } from './nativeproviders.js';

const RATE_PARTS = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheReadFallback', 'cacheWriteFallback'];

export function priceBaseName(name) {
  return String(name ?? '').trim().toLowerCase().split('/').at(-1)
    .replace(/:latest$/, '').replace(/[-_.@]20\d{2}(?:-?\d{2}){2}$/, '').replace(/\s+/g, '');
}

function rateSignature(record) {
  return JSON.stringify([...RATE_PARTS.map((part) => record[part] ?? null), record.contextTiers ?? [], record.official?.rules ?? []]);
}

// Shorter, unprefixed, undated names read best; ties keep catalog order.
function displayRank(name) {
  const raw = String(name).trim().toLowerCase();
  return [raw.includes('/') ? 1 : 0, raw === priceBaseName(raw) ? 0 : 1, raw.length];
}

function better(a, b) {
  const x = displayRank(a.name), y = displayRank(b.name);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}

export function groupPriceRecords(records, usedIds = new Set()) {
  const groups = new Map();
  for (const record of records ?? []) {
    const channel = nativeChannel(record.official?.channel ?? record.provider) ?? '';
    const key = [record.source, channel, priceBaseName(record.name), rateSignature(record)].join('\0');
    const group = groups.get(key);
    if (!group) groups.set(key, { primary: record, members: [record] });
    else {
      group.members.push(record);
      if (better(record, group.primary)) group.primary = record;
    }
  }
  return [...groups.values()].map(({ primary, members }) => ({
    ...primary,
    names: members.map((row) => row.name).sort(),
    ids: members.map((row) => row.id),
    used: members.some((row) => usedIds.has(row.id)),
  })).sort((a, b) => Number(b.used) - Number(a.used) || a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}
