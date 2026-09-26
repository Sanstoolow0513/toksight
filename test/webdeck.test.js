import test from 'node:test';
import assert from 'node:assert/strict';
import { packCards } from '../web/lib/deck.js';

test('packCards: cards that fit together share one page', () => {
  assert.deepEqual(packCards([100, 200, 150], 500, 16), { pages: [[0, 1, 2]], scroll: [false] });
  // 100 + 16 + 200 + 16 + 150 = 482 <= 500
  assert.deepEqual(packCards([100, 200, 150], 482, 16), { pages: [[0, 1, 2]], scroll: [false] });
});

test('packCards: the card that does not fit starts the next page', () => {
  // 100 + 16 + 200 = 316 fits; + 16 + 150 = 482 > 400 overflows.
  assert.deepEqual(packCards([100, 200, 150], 400, 16), { pages: [[0, 1], [2]], scroll: [false, false] });
  assert.deepEqual(packCards([300, 300, 300], 616, 16), { pages: [[0, 1], [2]], scroll: [false, false] });
});

test('packCards: the gap counts toward the page height', () => {
  // Without the gap the pair would be exactly 400; with it the second card spills.
  assert.deepEqual(packCards([200, 200], 400, 16), { pages: [[0], [1]], scroll: [false, false] });
  assert.deepEqual(packCards([200, 200], 400, 0), { pages: [[0, 1]], scroll: [false] });
});

test('packCards: an oversized card gets its own scrolling page', () => {
  assert.deepEqual(packCards([100, 800, 120], 400, 16), { pages: [[0], [1], [2]], scroll: [false, true, false] });
  // Packing continues after the oversized card instead of getting stuck.
  assert.deepEqual(packCards([800, 100, 120], 400, 16), { pages: [[0], [1, 2]], scroll: [true, false] });
});

test('packCards: degenerate inputs never throw', () => {
  assert.deepEqual(packCards([], 400, 16), { pages: [], scroll: [] });
  // No usable bound: everything on one page, no scroll flags.
  assert.deepEqual(packCards([100, 200], 0, 16), { pages: [[0, 1]], scroll: [false] });
  assert.deepEqual(packCards([100, 200], -5, 16), { pages: [[0, 1]], scroll: [false] });
  // Missing measurements count as zero-height cards.
  assert.deepEqual(packCards([undefined, 100], 400, 16), { pages: [[0, 1]], scroll: [false] });
});
