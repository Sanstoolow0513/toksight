import test from 'node:test';
import assert from 'node:assert/strict';
import { t, DEFAULT_LOCALE, tables, periodLabel, dayLabel, WEEKDAYS, MONTHS } from '../web/lib/i18n.js';

test('i18n returns Chinese by default and interpolates', () => {
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
  assert.equal(t('zh-CN', 'refresh'), '刷新');
  assert.equal(t('en', 'refresh'), 'Refresh');
  assert.equal(t('zh-CN', 'statStreakValue', { n: 12 }), '12 天');
  assert.equal(t('en', 'others', { n: 3 }), '3 other models');
  assert.equal(t('en', 'heroAgents', { n: 1 }), '1 agent');
  assert.equal(t('en', 'rowRequests', { n: '1' }), '1 request');
  assert.equal(t('en', 'rowRequests', { n: '1,001' }), '1,001 requests');
  assert.equal(t('zh-CN', 'missing-key-xyz'), 'missing-key-xyz');
});

test('zh-CN and en carry exactly the same key set', () => {
  // t() falls back across tables, so a key missing on one side would
  // silently show the other language's string to users.
  const zh = Object.keys(tables['zh-CN']).sort();
  const en = Object.keys(tables.en).sort();
  assert.deepEqual(zh, en);
  assert.ok(zh.length > 60, `expected a substantial table, got ${zh.length}`);
});

test('period and day labels are localized', () => {
  assert.equal(periodLabel('zh-CN', { mode: 'month', year: 2026, month: 9 }), '2026 年 9 月');
  assert.equal(periodLabel('en', { mode: 'month', year: 2026, month: 9 }), 'September 2026');
  assert.equal(periodLabel('zh-CN', { mode: 'year', year: 2026, month: 9 }), '2026 年');
  assert.equal(periodLabel('en', { mode: 'year', year: 2026, month: 9 }), '2026');
  assert.equal(dayLabel('zh-CN', '2026-09-05'), '9月5日');
  assert.equal(dayLabel('zh-CN', '2026-09-05', true), '2026年9月5日');
  assert.equal(dayLabel('en', '2026-09-05', true), 'Sep 5, 2026');
  for (const locale of ['zh-CN', 'en']) {
    assert.equal(WEEKDAYS[locale].length, 7);
    assert.equal(MONTHS[locale].length, 12);
  }
});
