import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_COLS, GRID_ITEM_IDS, defaultLayout, sanitizeLayout } from '../web/lib/layout.js';

// web/lib/layout.js is the layout contract for the dashboard grid
// (components/DashboardGrid.jsx): the default layout must tile the 12-col
// grid without overlaps, and sanitizeLayout decides whether a persisted
// localStorage copy is usable or falls back to the default.

test('defaultLayout: unique ids, inside the grid, no overlaps, valid mins', () => {
  const layout = defaultLayout();
  const ids = layout.map((item) => item.i);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  for (const item of layout) {
    assert.ok(item.x >= 0 && item.x + item.w <= GRID_COLS, `${item.i} out of columns`);
    assert.ok(item.y >= 0 && item.h >= 1, `${item.i} out of rows`);
    assert.ok(item.minW <= item.w && item.minH <= item.h, `${item.i} violates its min constraints`);
  }
  for (let a = 0; a < layout.length; a++) {
    for (let b = a + 1; b < layout.length; b++) {
      const A = layout[a];
      const B = layout[b];
      const overlap = A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
      assert.ok(!overlap, `${A.i} overlaps ${B.i}`);
    }
  }
});

test('defaultLayout returns fresh copies', () => {
  const a = defaultLayout();
  a[0].x = 99;
  assert.notEqual(defaultLayout()[0].x, 99);
});

test('sanitizeLayout drops unknown ids and fills missing ones from defaults', () => {
  const saved = [
    { i: 'trend', x: 2, y: 5, w: 6, h: 8 },
    { i: 'nope', x: 0, y: 0, w: 1, h: 1 },
  ];
  const out = sanitizeLayout(saved);
  assert.ok(!out.some((item) => item.i === 'nope'));
  assert.equal(out.length, GRID_ITEM_IDS.length);
  assert.deepEqual(out.find((item) => item.i === 'trend'), { i: 'trend', x: 2, y: 5, w: 6, h: 8, minW: 4, minH: 5 });
  assert.deepEqual(out.find((item) => item.i === 'sessions'), defaultLayout().find((item) => item.i === 'sessions'));
});

test('sanitizeLayout clamps oversized w, negative positions and zero h', () => {
  const out = sanitizeLayout([{ i: 'trend', x: 20, y: -3, w: 40, h: 0 }]);
  const trend = out.find((item) => item.i === 'trend');
  assert.equal(trend.w, GRID_COLS);
  assert.equal(trend.x, 0);
  assert.equal(trend.y, 0);
  assert.equal(trend.h, 1);
});

test('sanitizeLayout returns null for structural garbage', () => {
  assert.equal(sanitizeLayout(null), null);
  assert.equal(sanitizeLayout('[]'), null);
  assert.equal(sanitizeLayout({}), null);
  assert.equal(sanitizeLayout([null]), null);
  assert.equal(sanitizeLayout([['trend']]), null);
  assert.equal(sanitizeLayout([{ i: 'trend', x: '0', y: 0, w: 12, h: 10 }]), null);
  assert.equal(sanitizeLayout([{ i: 'trend', x: 0, y: Number.NaN, w: 12, h: 10 }]), null);
  assert.equal(sanitizeLayout([{ i: 'trend', x: 0, y: Infinity, w: 12, h: 10 }]), null);
});

test('sanitizeLayout skips duplicate ids instead of failing', () => {
  const saved = [
    { i: 'trend', x: 0, y: 0, w: 12, h: 10 },
    { i: 'trend', x: 1, y: 1, w: 6, h: 5 },
  ];
  const out = sanitizeLayout(saved);
  assert.equal(out.filter((item) => item.i === 'trend').length, 1);
});
