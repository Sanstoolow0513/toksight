// Explain the reference cost without changing normalized entries or their cost.
export function buildCostCoverage(entries, { pricing, reportedCosts }) {
  const sources = Object.fromEntries(['reported', 'cursor', 'user', 'litellm', 'builtin', 'unknown'].map((id) => [id, { requests: 0, costUsd: 0 }]));
  let unpricedRequests = 0, cacheFallbackRequests = 0;
  const prices = new Map();
  for (const entry of entries) {
    if (entry.costUsd == null) { unpricedRequests++; continue; }
    const key = `${entry.client}\u0000${entry.model}`;
    if (!prices.has(key)) prices.set(key, pricing.priceFor?.(entry.model, entry.client));
    const price = prices.get(key);
    const source = reportedCosts?.has(entry) ? 'reported' : price?.source in sources ? price.source : 'unknown';
    sources[source].requests++;
    sources[source].costUsd += entry.costUsd;
    if (source !== 'reported' && ((price?.cacheReadFallback && entry.cacheReadTokens > 0) || (price?.cacheWriteFallback && entry.cacheWriteTokens > 0))) cacheFallbackRequests++;
  }
  return { requests: entries.length, unpricedRequests, cacheFallbackRequests, sources };
}
