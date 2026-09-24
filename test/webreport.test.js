import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarWeeks, currentPeriod, dayKey, dayNav, eachDayKey, periodBounds, periodKey, periodNav, shiftDay, shiftPeriod, weekdayIndex, withMode,
} from '../web/lib/period.js';
import { agentRows, dailyMap, heatLevel, heatSummary, hourlyBars, modelRows, modelsByAgent, sessionName, sessionRows } from '../web/lib/report.js';
import { fmtClock, fmtClockRange, fmtCostShort, fmtTokens } from '../web/lib/format.js';

const usage = (over = {}) => {
  const row = { requests: 1, sessions: 1, inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 0, outputTokens: 100, reasoningTokens: 0, costUsd: 1, pricedRequests: 1, ...over };
  row.totalTokens = row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens + row.outputTokens;
  return row;
};

test('periods cover whole local months and years, including leap Februaries', () => {
  assert.deepEqual(periodBounds({ mode: 'month', year: 2028, month: 2 }), { since: '2028-02-01', until: '2028-02-29' });
  assert.deepEqual(periodBounds({ mode: 'month', year: 2026, month: 12 }), { since: '2026-12-01', until: '2026-12-31' });
  assert.deepEqual(periodBounds({ mode: 'year', year: 2026, month: 4 }), { since: '2026-01-01', until: '2026-12-31' });
  assert.equal(periodKey({ mode: 'month', year: 2026, month: 3 }), '2026-03');
  assert.equal(periodKey({ mode: 'year', year: 2026, month: 3 }), '2026');
  assert.deepEqual(currentPeriod('month', new Date(2026, 8, 22, 23, 59)), { mode: 'month', year: 2026, month: 9 });
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('period navigation crosses year boundaries and stays within the data', () => {
  assert.deepEqual(shiftPeriod({ mode: 'month', year: 2026, month: 1 }, -1), { mode: 'month', year: 2025, month: 12 });
  assert.deepEqual(shiftPeriod({ mode: 'month', year: 2025, month: 12 }, 1), { mode: 'month', year: 2026, month: 1 });
  assert.deepEqual(shiftPeriod({ mode: 'year', year: 2026, month: 5 }, -1), { mode: 'year', year: 2025, month: 5 });
  const sep = { mode: 'month', year: 2026, month: 9 };
  assert.deepEqual(periodNav(sep, { firstDay: '2026-08-29', today: '2026-09-22' }), { canPrev: true, canNext: false });
  assert.deepEqual(periodNav(sep, { firstDay: '2026-09-01', today: '2026-10-01' }), { canPrev: false, canNext: true });
  assert.deepEqual(periodNav(sep, { firstDay: null, today: '2026-09-22' }), { canPrev: false, canNext: false });
  // Switching to month mode never lands in the future.
  assert.deepEqual(withMode({ mode: 'year', year: 2026, month: 12 }, 'month', '2026-09-22'), { mode: 'month', year: 2026, month: 9 });
  assert.deepEqual(withMode({ mode: 'year', year: 2025, month: 12 }, 'month', '2026-09-22'), { mode: 'month', year: 2025, month: 12 });
});

test('calendar weeks start on Monday and pad outside the period', () => {
  assert.equal(weekdayIndex('2026-09-01'), 1); // Tuesday
  const weeks = calendarWeeks('2026-09-01', '2026-09-30');
  assert.equal(weeks.length, 5);
  assert.deepEqual(weeks[0].slice(0, 3), [null, '2026-09-01', '2026-09-02']);
  assert.ok(weeks.every((week) => week.length === 7));
  assert.equal(weeks.flat().filter(Boolean).length, 30);
  const year = calendarWeeks('2026-01-01', '2026-12-31');
  assert.equal(year.flat().filter(Boolean).length, 365);
  assert.equal(eachDayKey('2028-02-27', '2028-03-01').length, 4);
});

test('heat levels and summaries ignore future days and keep the scale period-wide', () => {
  assert.equal(heatLevel(0, 10), 0);
  assert.equal(heatLevel(10, 10), 4);
  assert.equal(heatLevel(0.1, 10), 1);
  assert.equal(heatLevel(1, 10), 2); // sqrt: a tenth of the peak already reads as level 2
  assert.equal(heatLevel(5, 0), 0);
  const days = dailyMap([
    { date: '2026-09-01', ...usage() },
    { date: '2026-09-02', ...usage({ inputTokens: 1000, costUsd: 5 }) },
    { date: '2026-09-04', ...usage() },
    { date: 'unknown', ...usage() },
  ]);
  assert.equal(days.size, 3);
  const tokens = heatSummary(days, { since: '2026-09-01', until: '2026-09-30', today: '2026-09-05' }, 'tokens');
  assert.equal(tokens.activeDays, 3);
  assert.equal(tokens.elapsedDays, 5);
  assert.equal(tokens.longestStreak, 2);
  assert.deepEqual(tokens.peak, { date: '2026-09-02', value: 1400 });
  assert.equal(tokens.max, 1400);
  const cost = heatSummary(days, { since: '2026-09-01', until: '2026-09-30', today: '2026-09-05' }, 'cost');
  assert.equal(cost.average, 7 / 3);
  const future = heatSummary(new Map(), { since: '2026-10-01', until: '2026-10-31', today: '2026-09-05' }, 'tokens');
  assert.deepEqual([future.elapsedDays, future.peak], [0, null]);
});

test('agent rows rank by the chosen metric with shares and token-class parts', () => {
  const clients = {
    claude: { ...usage({ inputTokens: 900, costUsd: 1 }), cacheHitRate: 0.25 },
    codex: { ...usage({ costUsd: 9, pricedRequests: 0 }), cacheHitRate: 0.75 },
  };
  const byTokens = agentRows(clients, 'tokens');
  assert.deepEqual(byTokens.map((r) => r.id), ['claude', 'codex']);
  assert.equal(byTokens[0].share, 1300 / 1800);
  assert.deepEqual(byTokens[1].parts, [0.2, 0.6, 0, 0.2]);
  assert.equal(byTokens[1].cacheHitRate, 0.75);
  assert.equal(byTokens[1].pricing, 'none');
  assert.deepEqual(agentRows(clients, 'cost').map((r) => r.id), ['codex', 'claude']);
});

test('model rows keep agents separate, fold the tail and keep shares whole', () => {
  const models = [
    { client: 'claude', model: 'm-a', ...usage({ inputTokens: 1000 }) },
    { client: 'opencode', model: 'm-a', ...usage({ pricedRequests: 0 }) },
    ...Array.from({ length: 9 }, (_, i) => ({ client: 'codex', model: `m-${i}`, ...usage({ outputTokens: 100 - i }) })),
  ];
  const { rows, others, count } = modelRows(models, 'tokens', 8);
  assert.equal(count, 11);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].model, 'm-a');
  assert.equal(rows[0].client, 'claude');
  assert.equal(rows[0].requests, 1);
  assert.equal(rows[0].pricing, 'full');
  assert.equal(others.count, 4);
  const shares = rows.reduce((sum, r) => sum + r.share, others.share);
  assert.ok(Math.abs(shares - 1) < 1e-9);
  assert.equal(modelRows(models.slice(0, 3), 'tokens', 8).others, null);
  const sameModel = modelRows(models.slice(0, 2), 'cost').rows;
  assert.deepEqual(sameModel.map((row) => [row.client, row.model, row.costUsd]), [
    ['claude', 'm-a', 1], ['opencode', 'm-a', 1],
  ]);
});

test('model costs group under each agent and keep period-wide shares', () => {
  const models = [
    { client: 'claude', model: 'opus', ...usage({ costUsd: 6, inputTokens: 100 }) },
    { client: 'claude', model: 'sonnet', ...usage({ costUsd: 3, inputTokens: 500 }) },
    { client: 'codex', model: 'gpt', ...usage({ costUsd: 1, inputTokens: 1000 }) },
    { client: 'codex', model: 'opus', ...usage({ costUsd: 0, inputTokens: 50 }) },
  ];
  const grouped = modelsByAgent(models, 'cost');
  assert.deepEqual(grouped.get('claude').rows.map((row) => row.model), ['opus', 'sonnet']);
  assert.equal(grouped.get('claude').rows[0].share, 0.6);
  assert.deepEqual(grouped.get('codex').rows.map((row) => row.model), ['gpt', 'opus']);
  assert.notEqual(grouped.get('claude').rows[0].id, grouped.get('codex').rows[1].id);
  const shares = [...grouped.values()].flatMap((group) => group.rows).reduce((sum, row) => sum + row.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9);

  const many = [
    { client: 'claude', model: 'big', ...usage({ costUsd: 20 }) },
    ...Array.from({ length: 8 }, (_, i) => ({ client: 'claude', model: `m-${i}`, ...usage({ costUsd: 1, outputTokens: 100 - i }) })),
    { client: 'codex', model: 'gpt', ...usage({ costUsd: 4 }) },
  ];
  const folded = modelsByAgent(many, 'cost', 8);
  assert.equal(folded.get('claude').rows.length, 7);
  assert.equal(folded.get('claude').rows[0].model, 'big');
  assert.equal(folded.get('claude').others.count, 2);
  assert.equal(folded.get('claude').others.value, 2);
  assert.equal(folded.get('codex').others, null);
  const foldedShares = [...folded.values()].flatMap((group) => [...group.rows, group.others].filter(Boolean))
    .reduce((sum, row) => sum + row.share, 0);
  assert.ok(Math.abs(foldedShares - 1) < 1e-9);
});

test('day stepping crosses month, year and leap-day boundaries in local time', () => {
  assert.equal(shiftDay('2026-09-30', 1), '2026-10-01');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftDay('2028-03-01', -1), '2028-02-29');
  // A DST switch day still steps by exactly one calendar day.
  assert.equal(shiftDay('2026-03-08', 1), '2026-03-09');
  assert.equal(shiftDay('2026-11-01', -1), '2026-10-31');
  assert.deepEqual(dayNav('2026-09-12', { firstDay: '2026-08-29', today: '2026-09-22' }), { canPrev: true, canNext: true });
  assert.deepEqual(dayNav('2026-08-29', { firstDay: '2026-08-29', today: '2026-09-22' }), { canPrev: false, canNext: true });
  assert.deepEqual(dayNav('2026-09-22', { firstDay: null, today: '2026-09-22' }), { canPrev: false, canNext: false });
});

test('hourly bars span all 24 hours and scale linearly to the busiest hour', () => {
  const hourly = [
    { hour: 9, input: 100, cacheRead: 300, cacheWrite: 0, output: 100, tokens: 500, costUsd: 2, requests: 3, sessions: 1 },
    { hour: 14, input: 0, cacheRead: 0, cacheWrite: 0, output: 1000, tokens: 1000, costUsd: 1, requests: 1, sessions: 1 },
  ];
  const tokens = hourlyBars(hourly, 'tokens');
  assert.equal(tokens.bars.length, 24);
  assert.equal(tokens.max, 1000);
  assert.equal(tokens.peak.hour, 14);
  assert.equal(tokens.bars[9].height, 0.5);
  assert.deepEqual(tokens.bars[9].parts, [0.2, 0.6, 0, 0.2]);
  assert.deepEqual([tokens.bars[0].value, tokens.bars[0].height], [0, 0]);
  assert.equal(hourlyBars(hourly, 'cost').peak.hour, 9);
  assert.equal(hourlyBars([], 'tokens').peak, null);
});

test('day sessions are named by title, then directory, and share the whole day', () => {
  assert.equal(sessionName({ title: '  fix\n the  heatmap ', directory: '/tmp/x' }), 'fix the heatmap');
  assert.equal(sessionName({ title: '', directory: 'C:\\Users\\me\\toksight\\' }), 'toksight');
  assert.equal(sessionName({ directory: '/home/me/proj' }), 'proj');
  assert.equal(sessionName({ title: null, directory: null }), null);
  const sessions = [
    { client: 'claude', sessionId: 'a', title: 'A', ...usage({ inputTokens: 900, costUsd: 3 }) },
    { client: 'codex', sessionId: 'b', directory: '/w/b', ...usage({ pricedRequests: 0 }) },
  ];
  const totals = usage({ inputTokens: 2000, costUsd: 8 });
  const rows = sessionRows(sessions, totals, 'tokens', 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'A');
  assert.equal(rows[0].share, 1300 / 2400);
  assert.equal(rows[0].pricing, 'full');
  const byCost = sessionRows(sessions, totals, 'cost');
  assert.deepEqual([byCost[1].name, byCost[1].share, byCost[1].pricing], ['b', 1 / 8, 'none']);
});

test('clock times are local and collapse equal minutes', () => {
  const start = new Date(2026, 8, 12, 9, 5).getTime();
  assert.equal(fmtClock(start), '09:05');
  assert.equal(fmtClockRange(start, new Date(2026, 8, 12, 11, 40).getTime()), '09:05–11:40');
  assert.equal(fmtClockRange(start, start + 20_000), '09:05');
  assert.equal(fmtClockRange(null, start), null);
  assert.equal(fmtClock(null), '—');
});

test('compact formatting fits calendar cells', () => {
  assert.equal(fmtCostShort(0), '$0');
  assert.equal(fmtCostShort(0.004), '<$0.01');
  assert.equal(fmtCostShort(3.456), '$3.46');
  assert.equal(fmtCostShort(45.67), '$45.7');
  assert.equal(fmtCostShort(1234), '$1.2K');
  assert.equal(fmtTokens(123_456_789), '123.5M');
  assert.equal(fmtTokens(12_345_678), '12.35M');
});
