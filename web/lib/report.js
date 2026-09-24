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

function tokenParts(row, keys = TOKEN_PARTS, total = row.totalTokens) {
  return keys.map((key) => (total > 0 ? (row[key] || 0) / total : 0));
}

function rank(rows, metric) {
  const total = rows.reduce((sum, row) => sum + metricValue(row, metric), 0);
  return rows
    .map((row) => ({
      ...row,
      value: metricValue(row, metric),
      share: total > 0 ? metricValue(row, metric) / total : 0,
      parts: tokenParts(row),
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

function foldRanked(ranked, metric, limit) {
  if (ranked.length <= limit) return { rows: ranked, others: null, count: ranked.length };
  const tail = ranked.slice(limit - 1);
  const others = rank([tail.reduce((acc, row) => sumInto(acc, row), { id: '__others__' })], metric)[0];
  others.share = tail.reduce((sum, row) => sum + row.share, 0);
  others.count = tail.length;
  return { rows: ranked.slice(0, limit - 1), others, count: ranked.length };
}

function rankedModels(models, metric) {
  return rank(models.map((row) => ({ ...row, id: JSON.stringify([row.client, row.model]) })), metric);
}

// The payload groups each agent's spelling variants under one display model.
// Keep agents separate so every row attributes its usage and cost to one agent.
// Beyond `limit` rows the tail folds into one "others" row.
export function modelRows(models = [], metric = 'tokens', limit = 8) {
  return foldRanked(rankedModels(models, metric), metric, limit);
}

// Same rows as `modelRows`, split under each agent. Shares stay against every
// model in the period, so a nested bar is comparable with its agent. Past
// `limit` models the tail folds inside that agent.
export function modelsByAgent(models = [], metric = 'cost', limit = 8) {
  const grouped = new Map();
  for (const row of rankedModels(models, metric)) {
    const list = grouped.get(row.client);
    if (list) list.push(row);
    else grouped.set(row.client, [row]);
  }
  return new Map([...grouped].map(([client, rows]) => [client, foldRanked(rows, metric, limit)]));
}

// The payload's `hourly` rows use short token keys (input/cacheRead/…/tokens).
const HOUR_PARTS = ['input', 'cacheRead', 'cacheWrite', 'output'];

// 24 local-hour bars scaled linearly to the busiest hour; missing hours are
// zero bars so the axis always spans the whole day.
export function hourlyBars(hourly = [], metric = 'tokens') {
  const byHour = new Map(hourly.map((row) => [row.hour, row]));
  const bars = Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour) ?? { hour };
    return { hour, row, value: (metric === 'cost' ? row.costUsd : row.tokens) || 0, parts: tokenParts(row, HOUR_PARTS, row.tokens) };
  });
  const max = bars.reduce((best, bar) => Math.max(best, bar.value), 0);
  for (const bar of bars) bar.height = max > 0 ? bar.value / max : 0;
  return { bars, max, peak: max > 0 ? bars.find((bar) => bar.value === max) : null };
}

// Sessions are named by their title, else the working directory's last
// segment (either path separator); null when neither is usable.
export function sessionName(row) {
  const title = typeof row.title === 'string' ? row.title.replace(/\s+/g, ' ').trim() : '';
  if (title) return title;
  const dir = typeof row.directory === 'string' ? row.directory.split(/[\\/]+/).filter(Boolean).pop() : '';
  return dir || null;
}

// The server already ranks `topSessions` by tokens; shares are of the whole
// day (`totals`), not just of the sessions shown.
export function sessionRows(sessions = [], totals = {}, metric = 'tokens', limit = 10) {
  const total = metricValue(totals, metric);
  return sessions.slice(0, limit).map((row) => ({
    ...row,
    name: sessionName(row),
    value: metricValue(row, metric),
    share: total > 0 ? metricValue(row, metric) / total : 0,
    parts: tokenParts(row),
    pricing: pricing(row),
  }));
}
