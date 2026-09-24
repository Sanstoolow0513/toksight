import { reportModelName } from './pricecatalog.js';

export function summarize(entries) {
  const t = {
    requests: entries.length,
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    pricedRequests: 0,
  };
  const sessionIds = new Set();
  for (const e of entries) {
    t.inputTokens += e.inputTokens;
    t.outputTokens += e.outputTokens;
    t.reasoningTokens += e.reasoningTokens;
    t.cacheReadTokens += e.cacheReadTokens;
    t.cacheWriteTokens += e.cacheWriteTokens;
    t.totalTokens += e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens;
    if (e.costUsd != null) {
      t.costUsd += e.costUsd;
      t.pricedRequests += 1;
    }
    if (e.sessionId != null) sessionIds.add(e.sessionId);
  }
  t.sessions = sessionIds.size;
  return t;
}

// Cache hit rate: share of prompt tokens served from cache
// = cacheRead / (fresh input + cacheRead). Cache writes are excluded because
// they are cold traffic being *stored*, not served.
export function cacheHitRate(totals) {
  const denom = totals.inputTokens + totals.cacheReadTokens;
  return denom > 0 ? totals.cacheReadTokens / denom : null;
}

const isFiniteTs = (ts) => ts != null && Number.isFinite(ts);

function group(entries, keyFn, decorate) {
  const groups = new Map();
  for (const e of entries) {
    const key = keyFn(e);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const rows = [];
  for (const [key, groupEntries] of groups) {
    // Loop, not Math.min(...entries): the spread form hits the ~65k argument
    // limit once one group grows large enough (e.g. a dominant model).
    // Missing timestamps are `null` — never Infinity/0 sentinels — so
    // downstream consumers (payload, render, webdata) pass them through
    // instead of each decoding its own sentinel.
    let firstAt = null;
    let lastAt = null;
    for (const e of groupEntries) {
      if (isFiniteTs(e.timestamp)) {
        if (firstAt == null || e.timestamp < firstAt) firstAt = e.timestamp;
        if (lastAt == null || e.timestamp > lastAt) lastAt = e.timestamp;
      }
    }
    rows.push({
      key,
      totals: summarize(groupEntries),
      firstAt,
      lastAt,
      ...decorate(groupEntries),
    });
  }
  return rows;
}

export function localDate(ts) {
  if (!isFiniteTs(ts)) return 'unknown';
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function localMonth(ts) {
  if (!isFiniteTs(ts)) return 'unknown';
  return localDate(ts).slice(0, 7);
}

export function byModel(entries, priceFor = null) {
  const names = new Map();
  const displayName = (entry) => {
    const key = `${entry.client}\0${entry.model}`;
    if (!names.has(key)) names.set(key, reportModelName(entry.model, entry.client, priceFor?.(entry.model, entry.client)));
    return names.get(key);
  };
  const rows = group(
    entries,
    (e) => JSON.stringify([e.client, displayName(e)]),
    (g) => ({
      client: g[0].client,
      model: displayName(g[0]),
      modelIds: [...new Set(g.map((e) => e.model))],
    }),
  );
  return rows.sort((a, b) => (b.totals.costUsd - a.totals.costUsd) || (b.totals.totalTokens - a.totals.totalTokens));
}

export function byClient(entries) {
  const rows = group(
    entries,
    (e) => e.client,
    (g) => ({ client: g[0].client }),
  );
  return rows.sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);
}

export function byDay(entries) {
  const rows = group(
    entries,
    (e) => localDate(e.timestamp),
    () => ({}),
  );
  return rows.sort((a, b) => (a.key === 'unknown' ? 1 : b.key === 'unknown' ? -1 : a.key.localeCompare(b.key)));
}

export function byMonth(entries) {
  const rows = group(
    entries,
    (e) => localMonth(e.timestamp),
    () => ({}),
  );
  return rows.sort((a, b) => (a.key === 'unknown' ? 1 : b.key === 'unknown' ? -1 : a.key.localeCompare(b.key)));
}

export function bySession(entries, priceFor = null) {
  const rows = group(
    entries.filter((e) => e.sessionId != null),
    (e) => `${e.client}/${e.sessionId}`,
    (g) => ({
      client: g[0].client,
      sessionId: g[0].sessionId,
      directory: g.find((e) => e.directory)?.directory ?? null,
      title: g.find((e) => e.title)?.title ?? null,
      models: [...new Set(g.map((e) => reportModelName(e.model, e.client, priceFor?.(e.model, e.client))))],
    }),
  );
  return rows.sort((a, b) => (b.totals.costUsd - a.totals.costUsd) || (b.lastAt ?? 0) - (a.lastAt ?? 0));
}

export function unpricedModels(entries, priceFor = null) {
  const set = new Set();
  for (const e of entries) {
    if (e.costUsd == null) set.add(reportModelName(e.model, e.client, priceFor?.(e.model, e.client)));
  }
  return [...set].sort();
}
