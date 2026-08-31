import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHeatmap,
  buildTrend,
  buildTrendByAgent,
  buildHourly,
  buildSessionRows,
  buildWebExtras,
  activityRange,
} from '../src/webdata.js';
import { localDate } from '../src/aggregate.js';

const DAY_MS = 24 * 3600 * 1000;

// Base entry: 2026-08-10 12:00 local time.
function entry(over = {}) {
  return {
    client: 'claude',
    sessionId: 's1',
    model: 'm1',
    timestamp: new Date(2026, 7, 10, 12).getTime(),
    inputTokens: 10,
    outputTokens: 5,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.01,
    directory: null,
    title: null,
    ...over,
  };
}

test('heatmap buckets by local day, zero-fills gaps, aligns to Sunday', () => {
  const now = new Date(2026, 7, 12, 15).getTime(); // 2026-08-12
  const entries = [
    entry({ sessionId: 'a', timestamp: new Date(2026, 7, 10, 9).getTime(), inputTokens: 100, outputTokens: 10 }),
    entry({ sessionId: 'a', timestamp: new Date(2026, 7, 10, 22).getTime(), inputTokens: 50 }),
    entry({ sessionId: 'b', timestamp: new Date(2026, 7, 11, 8).getTime(), inputTokens: 1 }),
    entry({ sessionId: 'c', timestamp: new Date(2026, 7, 12, 7).getTime(), inputTokens: 2 }),
  ];
  const heat = buildHeatmap(entries, { weeks: 2, now });

  // Grid = whole weeks starting Sunday, ending today (partial last column).
  assert.equal(heat.days.length, (2 - 1) * 7 + new Date(now).getDay() + 1);
  assert.equal(heat.end, localDate(now));
  assert.equal(new Date(Date.parse(`${heat.start}T00:00:00`)).getDay(), 0); // Sunday-aligned

  const d10 = heat.days.find((d) => d.date === '2026-08-10');
  assert.equal(d10.tokens, 100 + 10 + 50 + 5); // token total = input+output+cacheR+cacheW
  assert.equal(d10.requests, 2);
  assert.equal(d10.sessions, 1); // both entries belong to session 'a'
  assert.ok(Math.abs(d10.costUsd - 0.02) < 1e-9);

  const d11 = heat.days.find((d) => d.date === '2026-08-11');
  assert.equal(d11.tokens, 1 + 5);
  assert.equal(d11.sessions, 1);

  const today = heat.days.find((d) => d.date === localDate(now));
  assert.equal(today.tokens, 2 + 5);

  assert.equal(heat.maxTokens, d10.tokens);
});

test('heatmap excludes entries without a timestamp', () => {
  const now = new Date(2026, 7, 12, 15).getTime();
  const heat = buildHeatmap([entry({ timestamp: null }), entry({ timestamp: undefined })], { weeks: 1, now });
  assert.ok(heat.days.every((d) => d.tokens === 0));
  assert.equal(heat.maxTokens, 0);
});

test('hourly buckets use local hours and dedupe sessions per hour', () => {
  const entries = [
    entry({ sessionId: 'a', timestamp: new Date(2026, 7, 10, 9, 0).getTime() }),
    entry({ sessionId: 'a', timestamp: new Date(2026, 7, 10, 9, 30).getTime() }),
    entry({ sessionId: 'b', timestamp: new Date(2026, 7, 10, 23, 59).getTime(), inputTokens: 7 }),
  ];
  const hours = buildHourly(entries);
  assert.equal(hours.length, 24);
  assert.equal(hours[9].requests, 2);
  assert.equal(hours[9].sessions, 1);
  assert.equal(hours[9].tokens, 2 * (10 + 5));
  assert.equal(hours[23].tokens, 7 + 5);
  assert.ok(hours.every((h, i) => h.hour === i));
  // Untimestamped entries never crash the histogram.
  buildHourly([entry({ timestamp: null })]);
});

test('session rows group per client, compute duration, sort by tokens', () => {
  const entries = [
    // claude s1: two entries one hour apart → span 3600000ms, active capped at 5min
    entry({ client: 'claude', sessionId: 's1', inputTokens: 10, timestamp: new Date(2026, 7, 10, 10).getTime() }),
    entry({ client: 'claude', sessionId: 's1', inputTokens: 20, timestamp: new Date(2026, 7, 10, 11).getTime(), title: 'Fix bug' }),
    // codex s1 (same id, different client → separate session), bigger tokens
    entry({ client: 'codex', sessionId: 's1', inputTokens: 500, cacheReadTokens: 900, timestamp: new Date(2026, 7, 10, 12).getTime() }),
    // unknown timestamps → no duration, sorted by tokens only
    entry({ client: 'claude', sessionId: 's2', inputTokens: 5, timestamp: null }),
  ];
  const { topSessions, longestSession } = buildSessionRows(entries, { top: 10 });

  assert.equal(topSessions.length, 3);
  assert.equal(topSessions[0].client, 'codex'); // 1400 tokens wins
  assert.equal(topSessions[0].cacheReadTokens, 900);
  assert.equal(topSessions[0].activeMs, 0); // single request contributes no measurable time
  assert.equal(topSessions[1].client, 'claude');
  assert.equal(topSessions[1].sessionId, 's1');
  assert.equal(topSessions[1].title, 'Fix bug');
  assert.equal(topSessions[1].durationMs, 3600 * 1000);
  assert.equal(topSessions[1].activeMs, 5 * 60_000); // 1h gap capped at 5min
  assert.equal(topSessions[2].sessionId, 's2');
  assert.equal(topSessions[2].durationMs, null);
  assert.equal(topSessions[2].startedAt, null);

  assert.equal(longestSession.client, 'claude');
  assert.equal(longestSession.sessionId, 's1');
});

test('top limit applies to the sessions table but not to longestSession', () => {
  const entries = [];
  for (let i = 0; i < 5; i++) {
    const start = new Date(2026, 7, 1, i, 0).getTime();
    entries.push(
      entry({ sessionId: `s${i}`, inputTokens: 10 * (i + 1), timestamp: start }),
      entry({ sessionId: `s${i}`, inputTokens: 10 * (i + 1), timestamp: start + 60_000 * (i + 1) }),
    );
  }
  const { topSessions, longestSession } = buildSessionRows(entries, { top: 2 });
  assert.equal(topSessions.length, 2);
  assert.equal(topSessions[0].sessionId, 's4');
  // Longest by active time, even though it is NOT the top by tokens.
  assert.equal(longestSession.sessionId, 's4');
  assert.equal(longestSession.activeMs, 5 * 60_000);
});

test('longest session ranks by active time: an idle-spanning session loses', () => {
  const entries = [
    // 9h wall-clock span, but really two 5-minute bursts around a long break
    entry({ sessionId: 'idle', inputTokens: 10, timestamp: new Date(2026, 7, 10, 9).getTime() }),
    entry({ sessionId: 'idle', inputTokens: 10, timestamp: new Date(2026, 7, 10, 18).getTime() }),
    // 40 min of back-to-back requests (4 × 10min gaps → each capped at 5min)
    entry({ sessionId: 'busy', inputTokens: 5, timestamp: new Date(2026, 7, 10, 10).getTime() }),
    entry({ sessionId: 'busy', inputTokens: 5, timestamp: new Date(2026, 7, 10, 10, 10).getTime() }),
    entry({ sessionId: 'busy', inputTokens: 5, timestamp: new Date(2026, 7, 10, 10, 20).getTime() }),
    entry({ sessionId: 'busy', inputTokens: 5, timestamp: new Date(2026, 7, 10, 10, 30).getTime() }),
  ];
  const { longestSession, topSessions } = buildSessionRows(entries, { top: 10 });
  assert.equal(longestSession.sessionId, 'busy');
  assert.equal(longestSession.activeMs, 3 * 5 * 60_000);
  assert.equal(longestSession.durationMs, 30 * 60_000);
  const idleRow = topSessions.find((r) => r.sessionId === 'idle');
  assert.equal(idleRow.activeMs, 5 * 60_000); // one capped gap, despite the 9h span
  assert.equal(idleRow.durationMs, 9 * 3600 * 1000);
});

test('trendByAgent splits each day per client and zero-fills the window', () => {
  const now = new Date(2026, 7, 12, 15).getTime();
  const entries = [
    entry({
      client: 'zcode',
      timestamp: new Date(2026, 7, 11, 10).getTime(),
      inputTokens: 7,
      cacheReadTokens: 3,
      outputTokens: 2,
    }),
    entry({ client: 'kimi', timestamp: new Date(2026, 7, 11, 11).getTime(), inputTokens: 4 }),
    entry({ client: 'kimi', timestamp: new Date(2026, 7, 11, 12).getTime(), inputTokens: 1 }),
    entry({ client: 'claude', timestamp: null, inputTokens: 999 }), // never attributed
  ];
  const rows = buildTrendByAgent(entries, { days: 3, now });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].tokens, 0);
  assert.deepEqual(rows[0].clients, {});
  assert.equal(rows[1].tokens, 12 + 15); // zcode 12, kimi 9+6 (both + default 5 output)
  assert.deepEqual(rows[1].clients, { zcode: 12, kimi: 15 });
  assert.ok(Math.abs(rows[1].costUsd - 0.03) < 1e-9); // three priced entries
  assert.equal(rows[1].sessions, 1); // all three default to sessionId 's1'
  assert.equal(rows[2].date, localDate(now));
  // Untimestamped entries are excluded, not crash-worthy.
  assert.ok(!('claude' in rows[1].clients));
});

test('range stats: today / last 7 days / this month use local boundaries', () => {
  const now = new Date(2026, 7, 12, 18).getTime();
  const entries = [
    entry({ inputTokens: 100, timestamp: new Date(2026, 7, 12, 9).getTime() }), // today
    entry({ inputTokens: 200, timestamp: new Date(2026, 7, 6, 23).getTime() }), // 6 days ago → last7
    entry({ inputTokens: 400, timestamp: new Date(2026, 7, 5, 10).getTime() }), // 7 days ago → month only
    entry({ inputTokens: 800, timestamp: new Date(2026, 6, 31, 10).getTime() }), // July → excluded
  ];
  const extras = buildWebExtras(entries, { now });

  assert.equal(extras.today.tokens, 100 + 5);
  assert.equal(extras.today.sessions, 1);
  assert.equal(extras.last7Days.tokens, (100 + 5) + (200 + 5));
  // Last 30 days reaches back to Jul 14, so the Jul 31 entry counts too.
  assert.equal(extras.last30Days.tokens, (100 + 5) + (200 + 5) + (400 + 5) + (800 + 5));
  assert.equal(extras.thisMonth.tokens, (100 + 5) + (200 + 5) + (400 + 5));
  assert.ok(!(Date.now() === now)); // sanity: fixed `now` injection is not live time
});

test('streaks, peak day and activeDays cover the full history', () => {
  const now = new Date(2026, 7, 15, 9).getTime(); // 2026-08-15, no activity today yet
  const days = [
    [2026, 6, 10], [2026, 6, 11], [2026, 6, 12], // 3-day run in July (longest)
    [2026, 7, 1], // lone day
    [2026, 7, 13], [2026, 7, 14], [2026, 7, 15], // Aug 13–15 run, ends "today"
  ];
  const entries = days.map(([y, m, d]) =>
    entry({ sessionId: `s-${y}-${m}-${d}`, inputTokens: 10, timestamp: new Date(y, m, d, 10).getTime() }),
  );
  // Peak day gets extra tokens.
  entries.push(entry({ sessionId: 'peak', inputTokens: 1000, timestamp: new Date(2026, 7, 14, 20).getTime() }));

  const extras = buildWebExtras(entries, { now });
  assert.equal(extras.streaks.current, 3); // Aug 13–15, today counts even at 9am
  assert.equal(extras.streaks.longest, 3);
  assert.equal(extras.activeDays, 7);
  assert.equal(extras.peakDay.date, '2026-08-14');
  assert.equal(extras.peakDay.tokens, 10 + 5 + 1000 + 5); // day entry + peak entry (both +5 output)
  assert.ok(Math.abs(extras.peakDay.costUsd - 0.02) < 1e-9);

  // A stale history (nothing today or yesterday) reports a zero current streak.
  const stale = buildWebExtras([entry({ timestamp: new Date(2026, 6, 10, 10).getTime() })], { now });
  assert.equal(stale.streaks.current, 0);
  assert.equal(stale.streaks.longest, 1);
  assert.equal(stale.activeDays, 1);
  assert.equal(stale.peakDay.tokens, 10 + 5);
});

test('trend zero-fills the recent window and keeps token classes separate', () => {
  const now = new Date(2026, 7, 12, 15).getTime();
  const entries = [
    entry({
      timestamp: new Date(2026, 7, 11, 10).getTime(),
      inputTokens: 7,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
      outputTokens: 2,
    }),
  ];
  const trend = buildTrend(entries, { days: 3, now });
  assert.equal(trend.length, 3);
  assert.equal(trend[0].date, localDate(now - 2 * DAY_MS));
  assert.equal(trend[0].tokens, 0);
  assert.equal(trend[1].input, 7);
  assert.equal(trend[1].cacheRead, 3);
  assert.equal(trend[1].cacheWrite, 1);
  assert.equal(trend[1].output, 2);
  assert.equal(trend[1].tokens, 13);
  assert.equal(trend[2].date, localDate(now));
  assert.equal(trend[2].tokens, 0);
});

test('buildWebExtras exposes the dashboard payload shape', () => {
  const extras = buildWebExtras([entry()], { now: new Date(2026, 7, 10, 12).getTime() });
  for (const key of [
    'timezone',
    'activityRange',
    'heatmap',
    'trend',
    'trend7',
    'trend90',
    'trendByAgent',
    'hourly',
    'today',
    'last7Days',
    'last30Days',
    'thisMonth',
    'activeDays',
    'streaks',
    'peakDay',
    'topSessions',
    'longestSession',
  ]) {
    assert.ok(key in extras, `missing key ${key}`);
  }
  assert.deepEqual(activityRange([entry({ timestamp: null }), entry()]), {
    firstAt: new Date(2026, 7, 10, 12).getTime(),
    lastAt: new Date(2026, 7, 10, 12).getTime(),
  });
  assert.deepEqual(activityRange([]), { firstAt: null, lastAt: null });
  assert.equal(extras.heatmap.weeks, 53);
  assert.equal(extras.hourly.length, 24);
  assert.equal(extras.trend.length, 30);
  assert.equal(extras.trend7.length, 7);
  assert.equal(extras.trend90.length, 90);
  assert.deepEqual(extras.streaks, { current: 1, longest: 1 });
  assert.equal(extras.activeDays, 1);
  assert.equal(extras.peakDay.date, localDate(new Date(2026, 7, 10, 12).getTime()));
});
