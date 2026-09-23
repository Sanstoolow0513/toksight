// Pure report aggregations over one /api/data payload (already filtered to
// the selected period by the server). No React, no DOM — covered by
// test/webreport.test.js.

import { eachDayKey } from './period.js';

export const TOKEN_PARTS = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'];
const SUM_FIELDS = ['requests', 'sessions', ...TOKEN_PARTS, 'reasoningTokens', 'totalTokens', 'costUsd', 'pricedRequests'];

export function metricValue(row, metric) {
  return (metric === 'cost' ? row?.costUsd : row?.totalTokens) || 0;
}

export function cacheHitRate(row) {
  const denom = (row.inputTokens || 0) + (row.cacheReadTokens || 0);
  return denom > 0 ? row.cacheReadTokens / denom : null;
}

export function pricing(row) {
  if (!row.requests || row.pricedRequests >= row.requests) return 'full';
  return row.pricedRequests > 0 ? 'partial' : 'none';
}

export function dailyMap(daily = []) {
  return new Map(daily.filter((row) => row.date !== 'unknown').map((row) => [row.date, row]));
}

// sqrt keeps a single spike day from washing every other day out to level 1.
export function heatLevel(value, max) {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(value / max) * 4)));
}

// Stats over the period's elapsed days (a future day is neither idle nor
// active). `max` spans the whole period so the color scale stays put.
export function heatSummary(days, { since, until, today }, metric) {
  let max = 0;
  for (const row of days.values()) max = Math.max(max, metricValue(row, metric));
  const last = until < today ? until : today;
  const elapsed = since <= last ? eachDayKey(since, last) : [];
  let activeDays = 0;
  let total = 0;
  let peak = null;
  let run = 0;
  let longestStreak = 0;
  for (const date of elapsed) {
    const row = days.get(date);
    const value = metricValue(row, metric);
    if (row?.requests > 0) {
      activeDays += 1;
      run += 1;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 0;
    }
    total += value;
    if (value > 0 && (peak == null || value > peak.value)) peak = { date, value };
  }
  return { max, activeDays, elapsedDays: elapsed.length, average: activeDays ? total / activeDays : 0, peak, longestStreak };
}

function rank(rows, metric) {
  const total = rows.reduce((sum, row) => sum + metricValue(row, metric), 0);
  return rows
    .map((row) => ({
      ...row,
      value: metricValue(row, metric),
      share: total > 0 ? metricValue(row, metric) / total : 0,
      parts: TOKEN_PARTS.map((key) => (row.totalTokens > 0 ? (row[key] || 0) / row.totalTokens : 0)),
      cacheHitRate: cacheHitRate(row),
      pricing: pricing(row),
    }))
    .sort((a, b) => b.value - a.value || b.totalTokens - a.totalTokens);
}

export function agentRows(clients = {}, metric = 'tokens') {
  return rank(Object.entries(clients).map(([id, row]) => ({ ...row, id })), metric);
}

function sumInto(target, row) {
  for (const key of SUM_FIELDS) target[key] = (target[key] || 0) + (row[key] || 0);
  return target;
}

// The payload groups models per (agent, model); the report merges one model
// used through several agents. Beyond `limit` rows the tail folds into one
// "others" row so the card keeps a fixed height.
export function modelRows(models = [], metric = 'tokens', limit = 8) {
  const byName = new Map();
  for (const row of models) {
    let merged = byName.get(row.model);
    if (!merged) {
      merged = { id: row.model, model: row.model, clients: [] };
      byName.set(row.model, merged);
    }
    sumInto(merged, row);
    if (!merged.clients.includes(row.client)) merged.clients.push(row.client);
  }
  const ranked = rank([...byName.values()], metric);
  if (ranked.length <= limit) return { rows: ranked, others: null, count: ranked.length };
  const tail = ranked.slice(limit - 1);
  const others = rank([tail.reduce((acc, row) => sumInto(acc, row), { id: '__others__', clients: [] })], metric)[0];
  others.share = tail.reduce((sum, row) => sum + row.share, 0);
  others.count = tail.length;
  return { rows: ranked.slice(0, limit - 1), others, count: ranked.length };
}
