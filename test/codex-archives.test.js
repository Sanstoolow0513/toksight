import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { constants, zstdCompressSync } from 'node:zlib';
import { collect } from '../src/clients/codex.js';

const fixture = new URL('./fixtures/codex/sessions/2026/08/29/rollout-1.jsonl', import.meta.url);
const thread = '12345678-1111-2222-3333-123456789abc';
const rollout = (date, id = thread) => `rollout-${date}T00-00-00-${id}.jsonl`;

async function setup(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'toksight-codex-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return {
    collect: () => collect({ env: { CODEX_HOME: home } }),
    async write(relative, data) {
      const file = path.join(home, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },
  };
}

test('Codex reads plain and compressed rollouts in both roots with identical usage', async (t) => {
  const text = await readFile(fixture, 'utf8');
  const expected = (await collect({ env: { CODEX_HOME: path.join(import.meta.dirname, 'fixtures/codex') } })).entries;
  assert.equal(expected.length, 3);
  for (const root of ['sessions', 'archived_sessions']) {
    for (const compressed of [false, true]) {
      const source = await setup(t);
      await source.write(root + '/legacy.jsonl' + (compressed ? '.zst' : ''), compressed ? zstdCompressSync(text) : text);
      assert.deepEqual(await source.collect(), { entries: expected, warnings: [] });
    }
  }
});

test('Codex retains unique segments and per-file occurrences across archive copies', async (t) => {
  const source = await setup(t);
  const rows = (await readFile(fixture, 'utf8')).trim().split(/\r?\n/);
  const [meta, context, first, second, third] = rows;
  const replay = JSON.stringify({ type: 'session_meta', payload: { id: 'parent', cwd: '/replayed' } });
  const modelSwitch = context.replace('gpt-5.2', 'gpt-6.1-sol');
  const ownMeta = meta.replace('sess_codex1', thread);
  const plain = [ownMeta, context, first, first, replay, second];
  const archive = [ownMeta, first, context, second, modelSwitch, third];
  await source.write('sessions/' + rollout('2026-08-29'), plain.join('\n'));
  await source.write('archived_sessions/' + rollout('2026-08-30') + '.zst', zstdCompressSync(archive.join('\n')));
  const other = '12345678-1111-2222-3333-123456789abd';
  await source.write('sessions/' + rollout('2026-08-30', other), [meta, context, first].join('\n'));
  const { entries, warnings } = await source.collect();
  assert.deepEqual(warnings, []);
  const owned = entries.filter(e => e.sessionId === thread);
  assert.deepEqual(owned.map(e => e.inputTokens), [20, 20, 30, 170]);
  assert.deepEqual(owned.map(e => e.model), ['gpt-5.2', 'gpt-5.2', 'gpt-5.2', 'gpt-6.1-sol']);
  assert.ok(owned.every(e => e.directory === 'C:\\work\\demo'));
  assert.equal(entries.filter(e => e.sessionId === other).length, 1);
  assert.equal(entries.length, 5);
});

test('Codex resolves legacy identity from the first valid header, then the filename', async (t) => {
  const source = await setup(t);
  const [, context, first, second] = (await readFile(fixture, 'utf8')).trim().split(/\r?\n/);
  const meta = id => JSON.stringify({type: 'session_meta', payload: {id}});
  await source.write('sessions/legacy.jsonl', [meta(''), context, first, meta('owner'), meta('replayed'), second].join('\n'));
  await source.write('archived_sessions/no-header.jsonl.zst', zstdCompressSync([context, first].join('\n')));
  const { entries } = await source.collect();
  assert.deepEqual(entries.map(e => e.sessionId).sort(), ['no-header', 'owner', 'owner']);
});

test('Codex differences cumulative-only snapshots across successive segments', async (t) => {
  const source = await setup(t);
  const [, context, , second, third] = (await readFile(fixture, 'utf8')).trim().split(/\r?\n/);
  await source.write('sessions/' + rollout('2026-08-29'), [context, second].join('\n'));
  await source.write('archived_sessions/' + rollout('2026-08-30') + '.zst', zstdCompressSync([context, third].join('\n')));
  const { entries } = await source.collect();
  assert.deepEqual(entries.map(e => e.inputTokens), [30, 170]);
});

test('Codex discards a corrupt archive including any decoded prefix and reads healthy files', async (t) => {
  const source = await setup(t);
  const text = await readFile(fixture, 'utf8');
  const prefix = zstdCompressSync((text.trimEnd() + '\n').repeat(300));
  const truncated = zstdCompressSync(text).subarray(0, 5);
  await source.write('archived_sessions/broken.jsonl.zst', Buffer.concat([prefix, truncated]));
  await source.write('sessions/healthy.jsonl', text);
  const { entries, warnings } = await source.collect();
  assert.equal(entries.length, 3);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /broken\.jsonl\.zst/);
});

test('Codex reads concatenated checksummed frames across stream boundaries', async (t) => {
  const source = await setup(t);
  const rows = (await readFile(fixture, 'utf8')).trim().split(/\r?\n/);
  // The next magic number straddles the file stream's 64 KiB chunk boundary.
  const skippable = Buffer.alloc(65534);
  skippable.writeUInt32LE(0x184d2a50);
  skippable.writeUInt32LE(skippable.length - 8, 4);
  const options = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
  const head = zstdCompressSync(rows.slice(0, 3).join('\n') + '\n', options);
  const tail = zstdCompressSync(rows.slice(3).join('\n'), options);
  await source.write('archived_sessions/multipart.jsonl.zst', Buffer.concat([skippable, head, tail]));
  const { entries, warnings } = await source.collect();
  assert.deepEqual(warnings, []);
  assert.deepEqual(entries.map(e => e.inputTokens), [20, 30, 170]);
});
