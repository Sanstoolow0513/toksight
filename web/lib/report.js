// Pure report aggregations over one /api/data payload (already filtered to
// the selected period by the server). No React, no DOM — covered by
// test/webreport.test.js.

import { eachDayKey } from './period.js';

export const TOKEN_PARTS = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'];
export const SORT_KEYS = ['tokens', 'cost'];
const SUM_FIELDS = ['requests', 'sessions', ...TOKEN_PARTS, 'reasoningTokens', 'totalTokens', 'costUsd', 'pricedRequests'];

export function metricValue(row, metric) {
  return (metric === 'cost' ? row?.costUsd : row?.totalTokens) || 0;
}

// Blended cost per million tokens (cache reads included); it understates the
// rate when some requests are unpriced.
export function costPerMillion(row) {
  return row?.totalTokens > 0 && row.costUsd != null ? (row.costUsd / row.totalTokens) * 1e6 : null;
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

export function heatMax(days) {
  let max = 0;
  for (const row of days.values()) max = Math.max(max, metricValue(row, 'tokens'));
  return max;
}

// Stats over the period's elapsed days (a future day is neither idle nor
// active). Cells are shaded by tokens; `max` spans the whole period so the
// color scale stays put. The peak day is the busiest by tokens.
export function heatSummary(days, { since, until, today }) {
  const max = heatMax(days);
  const last = until < today ? until : today;
  const elapsed = since <= last ? eachDayKey(since, last) : [];
  let activeDays = 0;
  let tokens = 0;
  let cost = 0;
  let peak = null;
  let run = 0;
  let longestStreak = 0;
  for (const date of elapsed) {
    const row = days.get(date);
    if (row?.requests > 0) {
      activeDays += 1;
      run += 1;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 0;
    }
    tokens += metricValue(row, 'tokens');
    cost += metricValue(row, 'cost');
    const value = metricValue(row, 'tokens');
    if (value > 0 && (peak == null || value > peak.tokens)) peak = { date, tokens: value, cost: metricValue(row, 'cost') };
  }
  const average = activeDays ? { tokens: tokens / activeDays, cost: cost / activeDays } : null;
  return { max, activeDays, elapsedDays: elapsed.length, average, peak, longestStreak };
}

// The day an opened heatmap starts on: the marked day when the period shows
// it, else the period's latest active day, else its last elapsed day (null
// for a period that has not started).
export function openingDay(days, { since, until, today, selected }) {
  const last = until < today ? until : today;
  if (last < since) return null;
  if (selected && selected >= since && selected <= last) return selected;
  let latest = null;
  for (const [date, row] of days) {
    if (row.requests > 0 && date >= since && date <= last && (latest == null || date > latest)) latest = date;
  }
  return latest ?? last;
}

export function tokenParts(row, keys = TOKEN_PARTS, total = row.totalTokens) {
  return keys.map((key) => (total > 0 ? (row[key] || 0) / total : 0));
}

// Every row carries both shares (of the period's tokens and of its cost);
// `sortBy` only picks the order, ties falling back to tokens.
function rank(rows, sortBy) {
  const tokens = rows.reduce((sum, row) => sum + metricValue(row, 'tokens'), 0);
  const cost = rows.reduce((sum, row) => sum + metricValue(row, 'cost'), 0);
  return rows
    .map((row) => ({
      ...row,
      tokenShare: tokens > 0 ? metricValue(row, 'tokens') / tokens : 0,
      costShare: cost > 0 ? metricValue(row, 'cost') / cost : 0,
      parts: tokenParts(row),
      cacheHitRate: cacheHitRate(row),
      pricing: pricing(row),
    }))
    .sort((a, b) => metricValue(b, sortBy) - metricValue(a, sortBy) || b.totalTokens - a.totalTokens);
}

export function agentRows(clients = {}, sortBy = 'tokens') {
  return rank(Object.entries(clients).map(([id, row]) => ({ ...row, id })), sortBy);
}

function sumInto(target, row) {
  for (const key of SUM_FIELDS) target[key] = (target[key] || 0) + (row[key] || 0);
  return target;
}

function foldRanked(ranked, sortBy, limit) {
  if (ranked.length <= limit) return { rows: ranked, others: null, count: ranked.length };
  const tail = ranked.slice(limit - 1);
  const others = rank([tail.reduce((acc, row) => sumInto(acc, row), { id: '__others__' })], sortBy)[0];
  others.tokenShare = tail.reduce((sum, row) => sum + row.tokenShare, 0);
  others.costShare = tail.reduce((sum, row) => sum + row.costShare, 0);
  others.count = tail.length;
  return { rows: ranked.slice(0, limit - 1), others, count: ranked.length };
}

function rankedModels(models, sortBy) {
  return rank(models.map((row) => ({ ...row, id: JSON.stringify([row.client, row.model]) })), sortBy);
}

// The payload groups each agent's spelling variants under one display model.
// Keep agents separate so every row attributes its usage and cost to one agent.
// Beyond `limit` rows the tail folds into one "others" row.
export function modelRows(models = [], sortBy = 'tokens', limit = 8) {
  return foldRanked(rankedModels(models, sortBy), sortBy, limit);
}

// Same rows as `modelRows`, split under each agent. Shares stay against every
// model in the period, so a nested row is comparable with its agent. Past
// `limit` models the tail folds inside that agent.
export function modelsByAgent(models = [], sortBy = 'tokens', limit = 8) {
  const grouped = new Map();
  for (const row of rankedModels(models, sortBy)) {
    const list = grouped.get(row.client);
    if (list) list.push(row);
    else grouped.set(row.client, [row]);
  }
  return new Map([...grouped].map(([client, rows]) => [client, foldRanked(rows, sortBy, limit)]));
}

// The payload's `hourly` rows use short token keys (input/cacheRead/…/tokens).
const HOUR_PARTS = ['input', 'cacheRead', 'cacheWrite', 'output'];

// 24 local-hour token bars scaled linearly to the busiest hour; missing hours
// are zero bars so the axis always spans the whole day.
export function hourlyBars(hourly = []) {
  const byHour = new Map(hourly.map((row) => [row.hour, row]));
  const bars = Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour) ?? { hour };
    return { hour, row, value: row.tokens || 0, parts: tokenParts(row, HOUR_PARTS, row.tokens) };
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

// The server already ranks `topSessions` by tokens.
export function sessionRows(sessions = [], limit = 10) {
  return sessions.slice(0, limit).map((row) => ({ ...row, name: sessionName(row), pricing: pricing(row) }));
}
