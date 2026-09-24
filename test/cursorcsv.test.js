import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseCursorCsv } from '../src/cursorcsv.js';
import { cacheHitRate, summarize } from '../src/aggregate.js';

const fixture = new URL('./fixtures/cursor/usage.csv', import.meta.url);

test('Cursor CSV maps input, cache and charges without inventing sessions or subscription costs', async () => {
  const parsed = parseCursorCsv(await readFile(fixture, 'utf8'));
  assert.equal(parsed.rows, 3);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.zeroUsage, 1);
  assert.equal(parsed.skipped, 0);
  const [included, charged] = parsed.records.map((r) => r.entry);
  assert.deepEqual({ input: included.inputTokens, read: included.cacheReadTokens, write: included.cacheWriteTokens, output: included.outputTokens, cost: included.costUsd, session: included.sessionId },
    { input: 10, read: 30, write: 5, output: 4, cost: null, session: null });
  assert.equal(charged.costUsd, 0.25);
  const totals = summarize([included, charged]);
  assert.equal(totals.totalTokens, 94);
  assert.equal(totals.sessions, 0);
  assert.equal(totals.pricedRequests, 1);
  assert.equal(cacheHitRate(totals), 50 / 80);
});

test('CSV quoting, CRLF, BOM, overlapping exports and duplicate rows keep stable identities', async () => {
  const base = await readFile(fixture, 'utf8');
  const csv = `\ufeff${base.replaceAll('\n', '\r\n').replace('"cursor-test-model"', '"cursor,""test"""')}`;
  const parsed = parseCursorCsv(csv);
  assert.equal(parsed.records[0].entry.model, 'cursor,"test"');
  const twice = parseCursorCsv(`${base.trimEnd()}\n${base.split('\n')[1]}\n`);
  assert.equal(twice.records.length, 3);
  assert.notEqual(twice.records[0].key, twice.records[2].key);
  assert.equal(twice.records[0].key, parseCursorCsv(base).records[0].key);
  const rebilled = base
    .replace('"Included","cursor-test-model","No"', '"User API Key","cursor-test-model","Yes"')
    .replace('"49","Included"', '"49","$0.75"');
  assert.equal(parseCursorCsv(rebilled).records[0].key, parseCursorCsv(base).records[0].key);
  assert.equal(parseCursorCsv(rebilled).records[0].entry.costUsd, 0.75);
});

test('wrong headers and broken quotes fail; bad or empty usage rows are skipped', async () => {
  const base = await readFile(fixture, 'utf8');
  assert.throws(() => parseCursorCsv('Date,Tokens\n2026-01-01,2'), (err) => err.status === 400 && err.code === 'BAD_CSV');
  assert.throws(() => parseCursorCsv(`${base}"unterminated`), /unterminated quoted field/);
  const invalid = base.replace('"5","10","30","4","49"', '"5","10","30","4","999"');
  const parsed = parseCursorCsv(invalid);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.skipped, 1);
  assert.match(parsed.warnings[0], /Total Tokens/);
  const invalidDate = base.replace('2026-08-31T12:19:00.334Z', '2026-02-30T12:19:00.334Z');
  assert.equal(parseCursorCsv(invalidDate).skipped, 1);
});
