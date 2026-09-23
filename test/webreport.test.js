import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarWeeks, currentPeriod, dayKey, eachDayKey, periodBounds, periodKey, periodNav, shiftPeriod, weekdayIndex, withMode,
} from '../web/lib/period.js';
import { agentRows, dailyMap, heatLevel, heatSummary, modelRows } from '../web/lib/report.js';
import { fmtCostShort, fmtTokens } from '../web/lib/format.js';

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

test('model rows merge agents, fold the tail into one row and keep shares whole', () => {
  const models = [
    { client: 'claude', model: 'm-a', ...usage({ inputTokens: 1000 }) },
    { client: 'opencode', model: 'm-a', ...usage({ pricedRequests: 0 }) },
    ...Array.from({ length: 9 }, (_, i) => ({ client: 'codex', model: `m-${i}`, ...usage({ outputTokens: 100 - i }) })),
  ];
  const { rows, others, count } = modelRows(models, 'tokens', 8);
  assert.equal(count, 10);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].model, 'm-a');
  assert.deepEqual(rows[0].clients, ['claude', 'opencode']);
  assert.equal(rows[0].requests, 2);
  assert.equal(rows[0].pricing, 'partial');
  assert.equal(others.count, 3);
  const shares = rows.reduce((sum, r) => sum + r.share, others.share);
  assert.ok(Math.abs(shares - 1) < 1e-9);
  assert.equal(modelRows(models.slice(0, 3), 'tokens', 8).others, null);
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
