import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { walkFiles, pathExists, readJson, readJsonl } from '../src/fsutils.js';

function tmpTree(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-fs-'));
  for (const rel of files) {
    const full = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
  }
  return tmp;
}

test('walkFiles: missing root is silent (agent not installed)', async () => {
  const { files, warnings } = await walkFiles(path.join(os.tmpdir(), 'toksight-definitely-missing'));
  assert.deepEqual(files, []);
  assert.deepEqual(warnings, []);
});

test('walkFiles: a root that is a file warns instead of vanishing', async () => {
  const tmp = tmpTree(['plain.txt']);
  try {
    const { files, warnings } = await walkFiles(path.join(tmp, 'plain.txt'));
    assert.deepEqual(files, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /cannot read directory/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('walkFiles: walks nested dirs, applies the filter, returns sorted paths', async () => {
  const tmp = tmpTree(['b.json', 'a.json', 'sub/c.json', 'd.txt']);
  try {
    const { files, warnings } = await walkFiles(tmp, { filter: (name) => name.endsWith('.json') });
    assert.deepEqual(files.map((f) => path.relative(tmp, f)).map((p) => p.split(path.sep).join('/')), [
      'a.json',
      'b.json',
      'sub/c.json',
    ]);
    assert.deepEqual(warnings, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('pathExists: true for dirs and files, false for missing paths', async () => {
  const tmp = tmpTree(['file.txt']);
  try {
    assert.equal(await pathExists(tmp), true);
    assert.equal(await pathExists(path.join(tmp, 'file.txt')), true); // ENOTDIR case
    assert.equal(await pathExists(path.join(tmp, 'nope')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readJsonl: streams lines and yields null for malformed ones', async () => {
  const tmp = tmpTree([]);
  const file = path.join(tmp, 'log.jsonl');
  fs.writeFileSync(file, '{"a":1}\nnot json\n\n{"b":2}\n');
  try {
    const seen = [];
    await readJsonl(file, (o) => seen.push(o));
    assert.deepEqual(seen, [{ a: 1 }, null, { b: 2 }]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readJson: parses files and rejects missing ones', async () => {
  const tmp = tmpTree([]);
  const file = path.join(tmp, 'data.json');
  fs.writeFileSync(file, '{"ok":true}');
  try {
    assert.deepEqual(await readJson(file), { ok: true });
    await assert.rejects(() => readJson(path.join(tmp, 'missing.json')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
