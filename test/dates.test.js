import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dayKeyToTs,
  eachDay,
  endOfDay,
  parseDateArg,
  startOfDay,
  startOfMonth,
  stepDay,
} from '../src/dates.js';
import { localDate } from '../src/aggregate.js';

// 2026 DST transition dates in US zones (Mar 8, Nov 1) and an EU-adjacent
// day, plus ordinary days. Every assertion is about LOCAL calendar
// semantics, so it holds in any timezone — fixed-offset zones simply treat
// the transition dates as ordinary days, which these invariants allow.
const DAYS = ['2026-03-07', '2026-03-08', '2026-10-31', '2026-11-01', '2026-09-02'];

// A timestamp inside the local calendar day `key` (noon-ish, safely inside
// even a 23h DST day).
const inDay = (key) => dayKeyToTs(key) + 12 * 3600e3;

// The calendar day `key + n`, computed via the Date constructor's overflow
// handling — a different API path than stepDay's setDate, so the two can
// legitimately be cross-checked.
function advanceDayKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n).getTime());
}

test('endOfDay is the last ms of the same local day', () => {
  for (const day of DAYS) {
    const x = inDay(day);
    assert.equal(endOfDay(x), startOfDay(stepDay(x, 1)) - 1, day);
    assert.equal(localDate(endOfDay(x)), day, day);
  }
});

test('startOfDay truncates to the local midnight', () => {
  for (const day of DAYS) {
    const x = inDay(day);
    assert.equal(localDate(startOfDay(x)), day, day);
    assert.equal(startOfDay(x) <= x, true, day);
  }
});

test('stepDay(x, n) lands on the local calendar day x + n', () => {
  for (const day of DAYS) {
    const x = inDay(day);
    for (const n of [1, -1, 6, -6, 30]) {
      assert.equal(localDate(stepDay(x, n)), advanceDayKey(day, n), `${day} +${n}`);
    }
    // Stepping always produces a local midnight.
    const stepped = stepDay(x, 7);
    assert.equal(stepped, startOfDay(stepped), day);
  }
});

test('eachDay yields one consecutive local midnight per day, inclusive of both ends', () => {
  for (const day of DAYS) {
    const start = stepDay(inDay(day), -2);
    const end = stepDay(inDay(day), 2);
    const mids = [...eachDay(start, end)];
    assert.equal(mids.length, 5, day);
    for (const ts of mids) {
      assert.equal(ts, startOfDay(ts), day); // every yield is a local midnight
    }
    assert.equal(new Set(mids.map(localDate)).size, 5, day); // distinct calendar days
    assert.equal(mids[0], start, day);
    assert.equal(mids[4], end, day);
  }
});

test('eachDay snaps an off-midnight start to its local midnight', () => {
  const noon = inDay('2026-09-02');
  const mids = [...eachDay(noon, inDay('2026-09-03'))];
  assert.deepEqual(mids.map(localDate), ['2026-09-02', '2026-09-03']);
});

test('startOfMonth is the first local midnight of the month', () => {
  for (const day of ['2026-03-08', '2026-11-01', '2026-09-02', '2026-12-31']) {
    const ts = inDay(day);
    const som = startOfMonth(ts);
    const d = new Date(som);
    assert.equal(d.getDate(), 1, day);
    assert.equal(d.getMonth(), new Date(ts).getMonth(), day);
    assert.equal(d.getFullYear(), new Date(ts).getFullYear(), day);
    assert.equal(som, startOfDay(som), day);
  }
});

test('dayKeyToTs is the inverse of localDate and rejects non-dates', () => {
  for (const day of DAYS) {
    const ts = dayKeyToTs(day);
    assert.equal(localDate(ts), day, day);
    assert.equal(ts, startOfDay(ts), day);
  }
  assert.equal(dayKeyToTs('2026-9-2'), null); // not zero-padded
  assert.equal(dayKeyToTs('not-a-date'), null);
  assert.equal(dayKeyToTs(null), null);
});

test('parseDateArg maps to inclusive local-day boundaries', () => {
  for (const day of DAYS) {
    assert.equal(parseDateArg(day, 'start'), dayKeyToTs(day), day);
    assert.equal(parseDateArg(day, 'end'), endOfDay(dayKeyToTs(day)), day);
    assert.equal(localDate(parseDateArg(day, 'end')), day, day);
  }
  assert.throws(() => parseDateArg('2026/08/10', 'start'), /invalid date "2026\/08\/10"/);
  assert.throws(() => parseDateArg('', 'start'), /invalid date ""/);
  // Whitespace tolerance is preserved.
  assert.equal(parseDateArg(' 2026-09-02 ', 'start'), dayKeyToTs('2026-09-02'));
});
