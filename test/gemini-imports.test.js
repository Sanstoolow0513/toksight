import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { collect, sourceRoots } from '../src/clients/gemini.js';
import { createWebDataService } from '../src/webservice.js';
import { createUsageDatabase } from '../src/database.js';

const request = {
  id: 'r1', type: 'gemini', model: 'gemini-2.5-pro', timestamp: '2026-08-29T00:00:00Z',
  tokens: { input: 100, output: 20 },
};
const importTime = Date.parse('2026-08-30T00:00:00Z');
const marker = (time) => ({
  id: `import-${time}`, type: 'info', timestamp: new Date(time).toISOString(),
  content: 'Imported session from previous.jsonl',
});

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'toksight-gemini-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { env: {}, home };
}

async function session(root, sessionId, ...messages) {
  const dir = path.join(root, 'project', 'chats');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `session-${sessionId}.jsonl`);
  const metadata = { sessionId, directories: [sessionId + '-dir'] };
  await writeFile(file, [metadata, ...messages].map((row) => JSON.stringify(row)).join('\n'));
  return file;
}

test('Gemini imports keep the original request and count new turns on every refresh', async t => {
  const ctx = await fixture(t);
  const [root] = sourceRoots(ctx);
  await session(root, 'copy-a', marker(importTime), request);
  await session(root, 'copy-b', marker(importTime + 1), request);
  await session(root, 'original', request);
  const db = createUsageDatabase({ file: ':memory:' });
  const service = createWebDataService({ offline: true }, { ...ctx, database: db });
  try {
    assert.equal((await service.refresh()).entries, 1);
    const [original] = db.read().entries;
    assert.deepEqual([original.sessionId, original.directory, original.inputTokens + original.outputTokens],
      ['original', 'original-dir', 120]);
    const next = { ...request, id: 'r2', timestamp: '2026-08-31T00:00:00Z', tokens: { output: 5 } };
    await session(root, 'copy-a', marker(importTime), request, next);
    for (let i = 0; i < 2; i++) {
      assert.equal((await service.refresh()).entries, 2);
      const rows = db.read().entries;
      assert.equal(rows.reduce((n, e) => n + e.inputTokens + e.outputTokens, 0), 125);
      assert.equal(rows.find(e => e.outputTokens === 5).sessionId, 'copy-a');
    }
  } finally { service.close(); }
});

test('orphan Gemini history belongs to the earliest import, breaking ties by session ID', async t => {
  const ctx = await fixture(t);
  const [root, cache] = sourceRoots({ ...ctx, platform: 'darwin' });
  await session(root, 'a-later', marker(importTime + 1), request);
  await session(root, 'c-first', marker(importTime), request);
  await session(cache, 'b-first', marker(importTime), request);
  const original = await session(root, 'original', request);
  await unlink(original);
  for (const roots of [[root, cache], [cache, root]]) {
    const { entries } = await collect({ roots });
    assert.deepEqual(entries.map(e => e.sessionId), ['b-first']);
    assert.equal(entries[0].directory, 'b-first-dir');
    assert.equal(entries[0].inputTokens + entries[0].outputTokens, 120);
  }
});

test('independent Gemini sessions and distinct usage sharing a message ID survive import matching', async t => {
  const ctx = await fixture(t);
  const [root] = sourceRoots(ctx);
  await session(root, 'one', request);
  await session(root, 'two', request);
  await session(root, 'imported', marker(importTime), request);
  // Same report totals, different original input and tool token counts.
  await session(root, 'different', marker(importTime), { ...request, tokens: { input: 99, tool: 1, output: 20 } });
  assert.deepEqual((await collect(ctx)).entries.map(e => e.sessionId).sort(), ['different', 'one', 'two']);
});

test('macOS finds Seatbelt sessions and counts a mirrored session once', async t => {
  const { home } = await fixture(t);
  const base = path.join(home, 'override');
  const ctx = { home, env: { GEMINI_CLI_HOME: base }, platform: 'darwin' };
  const root = path.join(base, '.gemini', 'tmp');
  const cache = path.join(base, '.cache', '.gemini', 'tmp');
  assert.deepEqual(sourceRoots(ctx), [root, cache]);
  assert.deepEqual(sourceRoots({ ...ctx, platform: 'win32' }), [root]);
  await session(cache, 'same', request);
  assert.equal((await collect(ctx)).entries.length, 1);
  assert.deepEqual(await collect({ ...ctx, roots: [root] }), { entries: [], warnings: [] });
  await session(root, 'same', request);
  assert.equal((await collect(ctx)).entries.length, 1);
});
