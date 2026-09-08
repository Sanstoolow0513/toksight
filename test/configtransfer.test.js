import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentTransferService, BUNDLE_FORMAT } from '../src/agenttransfer.js';
import { compareConfig } from '../src/config/compare.js';
import { configFileGroups, exportFileIds, parseBundleText } from '../web/lib/transfer.js';

async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'toksight-migration-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const env = { TOKSIGHT_CONFIG_DIR: path.join(dir, 'toksight') };
  const svc = createAgentTransferService({ home: dir, env });
  const target = path.join(dir, '.claude', 'settings.json');
  await fs.mkdir(path.dirname(target), { recursive: true });
  return { dir, svc, target };
}
const bundle = (content, id = 'claude.settings') => ({ format: BUNDLE_FORMAT, version: 1, files: [{ id, content }] });
const expectations = (plan) => Object.fromEntries(plan.map((row) => [row.id, row.expected]));

test('preview distinguishes new, modified and unchanged files without revealing secret values', async (t) => {
  const { svc, target } = await setup(t);
  const next = '{"model":"new","env":{"ANTHROPIC_API_KEY":"new-private-value"}}';
  let { plan } = await svc.planImport(bundle(next));
  assert.equal(plan[0].change, 'new');
  await fs.writeFile(target, '{"model":"old","env":{"ANTHROPIC_API_KEY":"old-private-value"}}');
  ({ plan } = await svc.planImport(bundle(next)));
  assert.equal(plan[0].change, 'modified');
  assert.ok(plan[0].diff.lines.some((line) => line.kind === 'remove' && line.text.includes('old')));
  assert.ok(plan[0].diff.lines.some((line) => line.kind === 'add' && line.text.includes('new')));
  assert.doesNotMatch(JSON.stringify(plan), /old-private-value|new-private-value/);
  await svc.applyImport(bundle(next), { expected: expectations(plan) });
  const before = await svc.listBackups();
  ({ plan } = await svc.planImport(bundle(next)));
  assert.equal(plan[0].change, 'unchanged');
  assert.equal(plan[0].action, 'skip');
  const applied = await svc.applyImport(bundle(next));
  assert.equal(applied.results[0].reason, 'unchanged');
  assert.equal(applied.results[0].backupPath, null);
  assert.deepEqual(await svc.listBackups(), before);
});

test('hidden changes and truncated previews remain redacted', () => {
  const diff = compareConfig('{"apiKey":"first-value"}', '{"apiKey":"second-value"}', 'json');
  assert.equal(diff.hiddenChanges, true);
  assert.doesNotMatch(JSON.stringify(diff), /first-value|second-value/);
  const long = JSON.stringify({ env: { ANTHROPIC_API_KEY: 'a'.repeat(70000) + 'PRIVATE-END' }, model: 'new' });
  assert.doesNotMatch(JSON.stringify(compareConfig(null, long, 'json')), /PRIVATE-END|a{100}/);
  const toml = 'api_key = """\nraw-private-value\n"""\nmodel = "new"';
  assert.doesNotMatch(JSON.stringify(compareConfig('', toml, 'toml')), /raw-private-value/);
  assert.equal(compareConfig('', Array(1000).fill('model = "new"').join('\n'), 'toml').truncated, true);
});

test('line diff preserves both sides, including large replacement blocks', () => {
  for (const [a, b] of [
    ['a\nb\nc', 'a\nx\nc\nd'], ['same', 'same'], ['', 'new'], ['old', ''],
    [Array.from({ length: 450 }, (_, n) => `old${n}`).join('\n'), Array.from({ length: 450 }, (_, n) => `new${n}`).join('\n')],
  ]) {
    const { lines } = compareConfig(a, b, 'text');
    assert.equal(lines.filter((line) => line.kind !== 'add').map((line) => line.text).join('\n'), a);
    assert.equal(lines.filter((line) => line.kind !== 'remove').map((line) => line.text).join('\n'), b);
  }
});

test('apply refuses changed targets and changed sources after preview', async (t) => {
  const { svc, target } = await setup(t);
  await fs.writeFile(target, '{"model":"old"}');
  const incoming = bundle('{"model":"new"}');
  const { plan } = await svc.planImport(incoming);
  await fs.writeFile(target, '{"model":"external edit"}');
  let result = await svc.applyImport(incoming, { expected: expectations(plan) });
  assert.equal(result.results[0].reason, 'preview-changed');
  assert.equal(await fs.readFile(target, 'utf8'), '{"model":"external edit"}');
  const fresh = await svc.planImport(incoming);
  result = await svc.applyImport(bundle('{"model":"different source"}'), { expected: expectations(fresh.plan) });
  assert.equal(result.results[0].reason, 'preview-changed');
  assert.equal((await svc.listBackups()).backups.length, 0);
});

test('new target appearing after preview is not overwritten', async (t) => {
  const { svc, target } = await setup(t);
  const incoming = bundle('{"model":"new"}');
  const { plan } = await svc.planImport(incoming);
  await fs.writeFile(target, '{"model":"created elsewhere"}');
  const result = await svc.applyImport(incoming, { expected: expectations(plan) });
  assert.equal(result.results[0].reason, 'preview-changed');
});

test('restoring a backup creates an undo backup and exposes metadata only', async (t) => {
  const { svc, target } = await setup(t);
  const original = '{"model":"old","apiKey":"private-value"}';
  await fs.writeFile(target, original);
  await svc.applyImport(bundle('{"model":"new"}'));
  const listing = await svc.listBackups();
  assert.equal(listing.backups.length, 1);
  assert.equal(listing.backups[0].fileId, 'claude.settings');
  assert.doesNotMatch(JSON.stringify(listing), /private-value/);
  const restoring = await svc.bundleFromBackup(listing.backups[0].backupId);
  const { plan } = await svc.planImport(restoring);
  assert.doesNotMatch(JSON.stringify(plan), /private-value/);
  const result = await svc.applyImport(restoring, { expected: expectations(plan) });
  assert.equal(result.results[0].status, 'written');
  assert.equal(await fs.readFile(target, 'utf8'), original);
  assert.equal(await fs.readFile(result.results[0].backupPath, 'utf8'), '{"model":"new"}');
  assert.equal((await svc.listBackups()).backups.length, 2);
});

test('new backups distinguish ZCode config files with the same filename', async (t) => {
  const { dir, svc } = await setup(t);
  for (const folder of ['v2', 'cli']) {
    await fs.mkdir(path.join(dir, '.zcode', folder), { recursive: true });
    await fs.writeFile(path.join(dir, '.zcode', folder, 'config.json'), JSON.stringify({ folder }));
  }
  await svc.applyImport(bundle('{}', 'zcode.providers'));
  await svc.applyImport(bundle('{}', 'zcode.plugins'));
  const { backups } = await svc.listBackups();
  assert.deepEqual(backups.map((row) => row.fileId).sort(), ['zcode.plugins', 'zcode.providers']);
  for (const row of backups) {
    const recovered = await svc.bundleFromBackup(row.backupId);
    assert.equal(recovered.files[0].id, row.fileId);
    assert.equal(JSON.parse(recovered.files[0].content).folder, row.fileId === 'zcode.plugins' ? 'cli' : 'v2');
  }
});

test('legacy backups are supported only when their target is unambiguous', async (t) => {
  const { dir, svc } = await setup(t);
  const root = path.join(dir, 'toksight', 'backups');
  for (const [agent, name] of [['claude', 'settings.json'], ['zcode', 'config.json']]) {
    await fs.mkdir(path.join(root, agent), { recursive: true });
    await fs.writeFile(path.join(root, agent, `${name}.20260907-120000-000`), '{}');
  }
  const listing = await svc.listBackups();
  assert.equal(listing.backups.length, 1);
  assert.equal(listing.backups[0].fileId, 'claude.settings');
  assert.ok(listing.warnings.some((text) => text.includes('ambiguous')));
  await assert.rejects(svc.bundleFromBackup('zcode/config.json.20260907-120000-000'), /ambiguous/);
});

test('restore rejects forged ids, credentials, oversized files and symlinks', async (t) => {
  const { dir, svc, target } = await setup(t);
  await fs.writeFile(target, '{}');
  await svc.applyImport(bundle('{"model":"new"}'));
  const row = (await svc.listBackups()).backups[0];
  for (const id of ['../settings.json', row.path, 'claude/../../settings.json', 'claude/.credentials.json.20260907-120000-000', 'claude/..\\settings.json']) {
    await assert.rejects(svc.bundleFromBackup(id));
  }
  await fs.writeFile(row.path, 'a'.repeat(1024 * 1024 + 1));
  await assert.rejects(svc.bundleFromBackup(row.backupId), /1 MB/);
  await fs.unlink(row.path);
  try { await fs.symlink(target, row.path); }
  catch (err) { if (err.code === 'EPERM') { t.diagnostic('file symlinks unavailable'); return; } throw err; }
  await assert.rejects(svc.bundleFromBackup(row.backupId), /regular file/);
  assert.equal((await svc.listBackups()).backups.length, 0);
});

test('oversized target is refused consistently and migration checks are advisory', async (t) => {
  const { svc, target } = await setup(t);
  await fs.writeFile(target, 'a'.repeat(1024 * 1024 + 1));
  const incoming = bundle('{"command":"/usr/bin/tool","path":"C:\\\\tools","env_key":"CUSTOM_TOKEN"}');
  assert.equal((await svc.planImport(incoming)).plan[0].reason, 'target-oversize');
  assert.equal((await svc.applyImport(incoming)).results[0].reason, 'target-oversize');
  await fs.unlink(target);
  const { plan } = await svc.planImport(incoming);
  assert.deepEqual(plan[0].notes, ['absolute-paths', 'env-references', 'external-commands']);
  assert.equal(plan[0].action, 'write');
});

test('backup directory links are refused for listing, reading and writing', async (t) => {
  const { dir, svc, target } = await setup(t);
  await fs.writeFile(target, '{"model":"old"}');
  const outside = path.join(dir, 'outside');
  await fs.mkdir(outside);
  await fs.mkdir(path.join(dir, 'toksight'));
  await fs.symlink(outside, path.join(dir, 'toksight', 'backups'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await svc.applyImport(bundle('{"model":"new"}'));
  assert.equal(result.results[0].status, 'failed');
  assert.equal(result.results[0].backupPath, null);
  assert.equal(await fs.readFile(target, 'utf8'), '{"model":"old"}');
  assert.deepEqual(await fs.readdir(outside), []);
  const listing = await svc.listBackups();
  assert.equal(listing.backups.length, 0);
  assert.equal(listing.warnings.length, 1);
  await assert.rejects(svc.bundleFromBackup('claude/settings.json.20260907-120000-000'), /symlink/);
});

test('export selection includes only existing readable config files', () => {
  const file = { kind: 'config', exists: true, size: 10 };
  const groups = configFileGroups([{ id: 'agent', files: [
    { ...file, id: 'good' }, { ...file, id: 'missing', exists: false }, { ...file, id: 'secret', kind: 'secret' },
    { ...file, id: 'error', error: 'denied' }, { ...file, id: 'large', size: 1024 * 1024 + 1 },
  ] }]);
  assert.deepEqual(exportFileIds(groups, new Set()), ['good']);
  assert.deepEqual(exportFileIds(groups, new Set(['good'])), []);
  assert.throws(() => parseBundleText('{}'), /bad-bundle/);
  assert.deepEqual(parseBundleText(JSON.stringify(bundle('{}'))), bundle('{}'));
});
