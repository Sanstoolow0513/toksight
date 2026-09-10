import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE, colorAt } from '../web/lib/palette.js';

// palette.js and the --color-cat-* custom properties in globals.css are two
// copies of the same design-spec (§2) categorical ramp: PALETTE holds the
// light (:root) values, the dark ramp lives under [data-theme='dark'].
// Inline styles consume colorAt()'s var() references, so both themes follow
// one rank encoding. These tests pin the three pieces to each other.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'web', 'app', 'globals.css'), 'utf8');

const rampIn = (block) => {
  const out = [];
  for (let i = 1; i <= PALETTE.length; i++) {
    const match = block.match(new RegExp(`--color-cat-${i}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(match, `--color-cat-${i} not found`);
    out.push(match[1].toLowerCase());
  }
  return out;
};

test('globals.css :root --color-cat-1..5 match palette.js PALETTE', () => {
  const light = css.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
  assert.deepEqual(rampIn(light), PALETTE.map((color) => color.toLowerCase()));
});

test('globals.css defines a full dark rank ramp under [data-theme=\'dark\']', () => {
  const dark = css.match(/\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/)[1];
  const ramp = rampIn(dark);
  assert.ok(new Set(ramp).size === PALETTE.length, 'dark ramp must have 5 distinct steps');
  assert.notDeepEqual(ramp, PALETTE.map((color) => color.toLowerCase()));
});

test('colorAt() returns --color-cat-* var() references in rank order', () => {
  assert.equal(colorAt(0), 'var(--color-cat-1)');
  assert.equal(colorAt(4), 'var(--color-cat-5)');
  assert.equal(colorAt(5), 'var(--color-cat-1)');
});
