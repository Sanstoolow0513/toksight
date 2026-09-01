import test from 'node:test';
import assert from 'node:assert/strict';
import { t, DEFAULT_LOCALE } from '../web/lib/i18n.js';

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
