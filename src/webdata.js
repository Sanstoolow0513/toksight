// Web-dashboard aggregations for `toksight web`.
// Pure functions over normalized entries — no I/O, no CLI coupling, so they are
// trivially testable. All day/hour bucketing uses the machine's LOCAL time,
// matching the `daily`/`monthly` grouping in aggregate.js.

import { summarize, cacheHitRate, localDate, localMonth, bySession } from './aggregate.js';

const DAY_MS = 24 * 3600 * 1000;

function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function roundUsd(v) {
  return Math.round(v * 1e6) / 1e6;
}

function zeroDay(date) {
  return { date, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, tokens: 0, costUsd: 0, requests: 0, sessions: 0 };
}

// One bucket per local day that has timestamped activity. Entries without a
// timestamp are unattributable and intentionally excluded from time-series.
function buildDayBuckets(entries) {
  const buckets = new Map();
  for (const e of entries) {
    if (!Number.isFinite(e.timestamp)) continue;
    const key = localDate(e.timestamp);
    let b = buckets.get(key);
    if (!b) {
      b = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0, requests: 0, sessions: new Set() };
      buckets.set(key, b);
    }
    b.input += e.inputTokens;
    b.cacheRead += e.cacheReadTokens;
    b.cacheWrite += e.cacheWriteTokens;
    b.output += e.outputTokens;
    if (e.costUsd != null) b.costUsd += e.costUsd;
    b.requests += 1;
    b.sessions.add(e.sessionId);
  }
  return buckets;
}

function bucketRow(b, date) {
  return {
    date,
    input: b.input,
    cacheRead: b.cacheRead,
    cacheWrite: b.cacheWrite,
    output: b.output,
    tokens: b.input + b.cacheRead + b.cacheWrite + b.output,
    costUsd: roundUsd(b.costUsd),
    requests: b.requests,
    sessions: b.sessions.size,
  };
}

// Steps local midnights (not +24h hops) so DST transitions can't skip or
// duplicate a day key.
function* localMidnights(startTs, endTs) {
  const d = new Date(startTs);
  while (d.getTime() <= endTs) {
    yield d.getTime();
    d.setDate(d.getDate() + 1);
  }
}

// GitHub-style grid: whole weeks starting on Sunday, ending at today. The last
// column is partial (only up to today's weekday), so days.length is
// (weeks - 1) * 7 + weekdayOf(now) + 1.
export function buildHeatmap(entries, { weeks = 53, now = Date.now() } = {}) {
  const buckets = buildDayBuckets(entries);
  const todayStart = startOfDay(now);
  const gridStart = todayStart - ((weeks - 1) * 7 + new Date(now).getDay()) * DAY_MS;
  const days = [];
  let maxTokens = 0;
  for (const ts of localMidnights(gridStart, todayStart)) {
    const date = localDate(ts);
    const row = buckets.has(date) ? bucketRow(buckets.get(date), date) : zeroDay(date);
    if (row.tokens > maxTokens) maxTokens = row.tokens;
    days.push(row);
  }
  return { days, weeks, maxTokens, start: localDate(gridStart), end: localDate(todayStart) };
}

// Zero-filled per-day rows for the recent-trend chart, with token classes kept
// separate so the UI can stack fresh input / cache reads / output.
export function buildTrend(entries, { days = 30, now = Date.now() } = {}) {
  const buckets = buildDayBuckets(entries);
  const todayStart = startOfDay(now);
  const rows = [];
  for (const ts of localMidnights(todayStart - (days - 1) * DAY_MS, todayStart)) {
    const date = localDate(ts);
    rows.push(buckets.has(date) ? bucketRow(buckets.get(date), date) : zeroDay(date));
  }
  return rows;
}

// Same daily zero-filled window, but split per agent so the trend chart can
// cross time × agent. Each row is `{ date, tokens, costUsd, sessions,
// clients: {id: tokens} }`; agents absent on a day are simply missing from
// the map (treated as 0). cost/sessions are day totals shared with the
// class-split trend rows.
export function buildTrendByAgent(entries, { days = 30, now = Date.now() } = {}) {
  const buckets = buildDayBuckets(entries);
  const perClient = new Map();
  for (const e of entries) {
    if (!Number.isFinite(e.timestamp)) continue;
    const key = localDate(e.timestamp);
    let c = perClient.get(key);
    if (!c) {
      c = new Map();
      perClient.set(key, c);
    }
    const t = e.inputTokens + e.outputTokens + e.cacheReadTokens + e.cacheWriteTokens;
    c.set(e.client, (c.get(e.client) || 0) + t);
  }
  const todayStart = startOfDay(now);
  const rows = [];
  for (const ts of localMidnights(todayStart - (days - 1) * DAY_MS, todayStart)) {
    const date = localDate(ts);
    const b = buckets.get(date);
    const c = perClient.get(date);
    rows.push({
      date,
      tokens: b ? b.input + b.cacheRead + b.cacheWrite + b.output : 0,
      costUsd: b ? roundUsd(b.costUsd) : 0,
      sessions: b ? b.sessions.size : 0,
      clients: c ? Object.fromEntries(c) : {},
    });
  }
  return rows;
}

export function buildHourly(entries) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    costUsd: 0,
    requests: 0,
    sessions: new Set(),
  }));
  for (const e of entries) {
    if (!Number.isFinite(e.timestamp)) continue;
    const h = hours[new Date(e.timestamp).getHours()];
    h.input += e.inputTokens;
    h.cacheRead += e.cacheReadTokens;
    h.cacheWrite += e.cacheWriteTokens;
    h.output += e.outputTokens;
    if (e.costUsd != null) h.costUsd += e.costUsd;
    h.requests += 1;
    h.sessions.add(e.sessionId);
  }
  return hours.map(({ sessions, ...h }) => ({
    ...h,
    tokens: h.input + h.cacheRead + h.cacheWrite + h.output,
    costUsd: roundUsd(h.costUsd),
    sessions: sessions.size,
  }));
}

// Idle gaps longer than this don't count toward a session's active time: a
// wall-clock span (first→last entry) happily counts overnight/lunch breaks, so
// a session resumed the next morning would look like a 12h+ run. The 5-minute
// timeout is the usual coding-agent convention; single requests contribute no
// measurable time.
export const ACTIVE_GAP_CAP_MS = 5 * 60 * 1000;

function activeMsOf(timestamps) {
  const ts = timestamps.filter(Number.isFinite).sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < ts.length; i++) active += Math.min(ts[i] - ts[i - 1], ACTIVE_GAP_CAP_MS);
  return active;
}

function sessionRow(r, activeMs) {
  const startedAt = Number.isFinite(r.firstAt) ? r.firstAt : null;
  const endedAt = r.lastAt > 0 ? r.lastAt : null;
  return {
    client: r.client,
    sessionId: r.sessionId,
    directory: r.directory,
    title: r.title,
    models: r.models,
    requests: r.totals.requests,
    inputTokens: r.totals.inputTokens,
    outputTokens: r.totals.outputTokens,
    reasoningTokens: r.totals.reasoningTokens,
    cacheReadTokens: r.totals.cacheReadTokens,
    cacheWriteTokens: r.totals.cacheWriteTokens,
    totalTokens: r.totals.totalTokens,
    costUsd: roundUsd(r.totals.costUsd),
    cacheHitRate: cacheHitRate(r.totals),
    startedAt,
    endedAt,
    durationMs: startedAt != null && endedAt != null ? endedAt - startedAt : null,
    activeMs,
  };
}

// Top sessions ranked by tokens (the CLI `sessions` command ranks by cost),
// plus the single longest session ranked by ACTIVE time (idle-capped), not by
// wall-clock span. `durationMs` keeps the raw span for backwards compat.
export function buildSessionRows(entries, { top = 20 } = {}) {
  const stamps = new Map();
  for (const e of entries) {
    const key = `${e.client}/${e.sessionId}`;
    if (!stamps.has(key)) stamps.set(key, []);
    stamps.get(key).push(e.timestamp);
  }
  const rows = bySession(entries).map((r) => sessionRow(r, activeMsOf(stamps.get(`${r.client}/${r.sessionId}`) ?? [])));
  rows.sort((a, b) => b.totalTokens - a.totalTokens || (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const longestSession = rows
    .filter((r) => r.durationMs != null)
    .reduce(
      (best, r) =>
        best == null || r.activeMs > best.activeMs || (r.activeMs === best.activeMs && r.durationMs > best.durationMs)
          ? r
          : best,
      null,
    );
  return { topSessions: rows.slice(0, top), longestSession };
}

function rangeStats(entries, pred) {
  const t = summarize(entries.filter(pred));
  return {
    tokens: t.totalTokens,
    costUsd: roundUsd(t.costUsd),
    requests: t.requests,
    sessions: t.sessions,
    pricedRequests: t.pricedRequests,
  };
}

export function activityRange(entries) {
  let firstAt = null;
  let lastAt = null;
  for (const e of entries) {
    if (!Number.isFinite(e.timestamp)) continue;
    if (firstAt == null || e.timestamp < firstAt) firstAt = e.timestamp;
    if (lastAt == null || e.timestamp > lastAt) lastAt = e.timestamp;
  }
  return { firstAt, lastAt };
}

function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// DST-safe day step on local midnights (never a blind +24h hop).
function stepDay(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Consecutive active-day runs over ALL history (not just the heatmap window).
// `current` may end yesterday: a day still in progress shouldn't reset it.
function computeStreaks(activeDates, now) {
  const active = new Set(activeDates);
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const date of activeDates) {
    const ts = Date.parse(`${date}T00:00:00`);
    run = prev != null && stepDay(prev, 1) === ts ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = ts;
  }
  let cursor = startOfDay(now);
  if (!active.has(localDate(cursor))) cursor = stepDay(cursor, -1);
  let current = 0;
  while (active.has(localDate(cursor))) {
    current += 1;
    cursor = stepDay(cursor, -1);
  }
  return { current, longest };
}

// Per-day rows over the FULL history (heatmap only covers the recent window).
function allDayRows(entries) {
  return [...buildDayBuckets(entries).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => bucketRow(b, date));
}

// Everything the dashboard needs beyond the `--json` payload. `top` mirrors the
// CLI --top limit for the sessions table.
export function buildWebExtras(entries, { top = 20, weeks = 53, now = Date.now() } = {}) {
  const { topSessions, longestSession } = buildSessionRows(entries, { top });
  const activeDays = allDayRows(entries).filter((d) => d.tokens > 0);
  const peakDay = activeDays.reduce(
    (best, d) => (best == null || d.tokens > best.tokens ? { date: d.date, tokens: d.tokens, costUsd: d.costUsd } : best),
    null,
  );
  return {
    timezone: localTimezone(),
    activityRange: activityRange(entries),
    heatmap: buildHeatmap(entries, { weeks, now }),
    trend: buildTrend(entries, { days: 30, now }),
    trend7: buildTrend(entries, { days: 7, now }),
    trend90: buildTrend(entries, { days: 90, now }),
    trendByAgent: {
      7: buildTrendByAgent(entries, { days: 7, now }),
      30: buildTrendByAgent(entries, { days: 30, now }),
      90: buildTrendByAgent(entries, { days: 90, now }),
    },
    hourly: buildHourly(entries),
    today: rangeStats(entries, (e) => Number.isFinite(e.timestamp) && localDate(e.timestamp) === localDate(now)),
    last7Days: rangeStats(entries, (e) => Number.isFinite(e.timestamp) && e.timestamp >= startOfDay(now - 6 * DAY_MS)),
    last30Days: rangeStats(entries, (e) => Number.isFinite(e.timestamp) && e.timestamp >= startOfDay(now - 29 * DAY_MS)),
    thisMonth: rangeStats(entries, (e) => Number.isFinite(e.timestamp) && localMonth(e.timestamp) === localMonth(now)),
    activeDays: activeDays.length,
    streaks: computeStreaks(
      activeDays.map((d) => d.date),
      now,
    ),
    peakDay,
    topSessions,
    longestSession,
  };
}
