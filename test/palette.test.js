import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE } from '../web/lib/palette.js';

// palette.js and the --color-cat-* custom properties in globals.css are two
// copies of the same design-spec (v7 §2) categorical ramp. This test pins
// them to each other so neither side can drift on its own.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'web', 'app', 'globals.css'), 'utf8');

test('globals.css --color-cat-1..5 match palette.js PALETTE', () => {
  const fromCss = [];
  for (let i = 1; i <= PALETTE.length; i++) {
    const match = css.match(new RegExp(`--color-cat-${i}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(match, `--color-cat-${i} not found in globals.css`);
    fromCss.push(match[1].toLowerCase());
  }
  assert.deepEqual(fromCss, PALETTE.map((color) => color.toLowerCase()));
});
