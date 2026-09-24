import { byClient, byModel, cacheHitRate, summarize } from './aggregate.js';
import { calendarDaysBetween, endOfDay, startOfDay, stepDay } from './dates.js';
import { buildCostCoverage } from './costcoverage.js';

function costDifference(current, previous) {
  const delta = current - previous;
  return Math.abs(delta) <= Number.EPSILON * Math.max(1, Math.abs(current), Math.abs(previous)) * 8 ? 0 : delta;
}

function contributions(current, previous, group, key) {
  const rows = new Map();
  for (const [period, entries] of [['current', current], ['previous', previous]]) {
    for (const row of group(entries)) {
      const id = key(row);
      if (!rows.has(id)) rows.set(id, { client: row.client, ...(row.model == null ? {} : { model: row.model }), currentCostUsd: 0, previousCostUsd: 0, currentTokens: 0, previousTokens: 0 });
      const target = rows.get(id);
      target[`${period}CostUsd`] = row.totals.costUsd;
      target[`${period}Tokens`] = row.totals.totalTokens;
    }
  }
  return [...rows.values()].map((row) => ({ ...row, costDelta: costDifference(row.currentCostUsd, row.previousCostUsd), tokenDelta: row.currentTokens - row.previousTokens }))
    .sort((a, b) => Math.abs(b.costDelta) - Math.abs(a.costDelta) || Math.abs(b.tokenDelta) - Math.abs(a.tokenDelta));
}

export function buildComparison(entries, opts, base, context, now = Date.now()) {
  const until = opts.until ?? endOfDay(now);
  const since = opts.since ?? stepDay(startOfDay(until), -6);
  if (since > until) return { available: false, reason: 'empty-range' };
  const days = calendarDaysBetween(since, until) + 1;
  const previousSince = stepDay(since, -days), previousUntil = since - 1;
  if (base.since != null && previousSince < base.since) return { available: false, reason: 'startup-range' };
  const current = [], previous = [];
  let untimestampedRequests = 0;
  for (const entry of entries) {
    if (!Number.isFinite(entry.timestamp)) { untimestampedRequests++; continue; }
    if (entry.timestamp >= since && entry.timestamp <= until) current.push(entry);
    if (entry.timestamp >= previousSince && entry.timestamp <= previousUntil) previous.push(entry);
  }
  const period = (values, start, end) => {
    const totals = summarize(values);
    return { since: start, until: end, totals, cacheHitRate: cacheHitRate(totals), costCoverage: buildCostCoverage(values, context) };
  };
  const a = period(current, since, until), b = period(previous, previousSince, previousUntil);
  const costDelta = costDifference(a.totals.costUsd, b.totals.costUsd);
  return {
    available: true, days, current: a, previous: b, partialCurrent: since <= now && now < until,
    untimestampedRequests,
    delta: { costUsd: costDelta, totalTokens: a.totals.totalTokens - b.totals.totalTokens, requests: a.totals.requests - b.totals.requests,
      cacheHitRate: a.cacheHitRate == null || b.cacheHitRate == null ? null : a.cacheHitRate - b.cacheHitRate },
    costChangePercent: b.totals.costUsd > 0 ? costDelta / b.totals.costUsd : null,
    byClient: contributions(current, previous, byClient, (row) => row.client),
    byModel: contributions(current, previous, (values) => byModel(values, context.pricing?.priceFor),
      (row) => JSON.stringify([row.client, row.model])),
  };
}
