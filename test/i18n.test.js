import test from 'node:test';
import assert from 'node:assert/strict';
import { t, DEFAULT_LOCALE, tables } from '../web/lib/i18n.js';

test('i18n returns Chinese by default and interpolates', () => {
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
  assert.equal(t('zh-CN', 'refresh'), '刷新');
  assert.equal(t('en', 'refresh'), 'Refresh');
  assert.equal(t('zh-CN', 'statStreakValue', { n: 12 }), '12 天');
  assert.equal(t('en', 'heatWeekday', { day: 'Fri' }), 'Fri');
  assert.equal(t('zh-CN', 'missing-key-xyz'), 'missing-key-xyz');
});

test('warnPrefix carries its own locale-appropriate separator', () => {
  // The separator must live in the string table (not the JSX), so each locale
  // gets its own colon.
  assert.match(t('zh-CN', 'warnPrefix'), /：$/);
  assert.match(t('en', 'warnPrefix'), /: $/);
});

test('zh-CN and en carry exactly the same key set', () => {
  // t() falls back across tables, so a key missing on one side would
  // silently show the other language's string to users.
  const zh = Object.keys(tables['zh-CN']).sort();
  const en = Object.keys(tables.en).sort();
  assert.deepEqual(zh, en);
  assert.ok(zh.length > 200, `expected a substantial table, got ${zh.length}`);
});
