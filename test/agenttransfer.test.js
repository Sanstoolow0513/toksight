import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BUNDLE_FORMAT, createAgentTransferService } from '../src/agenttransfer.js';

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-transfer-'));
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-transfer-config-'));
  const env = { TOKSIGHT_CONFIG_DIR: configRoot };
  const svc = createAgentTransferService({ env, home });
  return { home, configRoot, env, svc };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function entry(overrides = {}) {
  return {
    id: 'claude.settings',
    agentId: 'claude',
    fileName: 'settings.json',
    format: 'json',
    path: '/somewhere/else/settings.json',
    content: JSON.stringify({ model: 'claude-haiku-4.5' }),
    ...overrides,
  };
}

function bundleOf(files) {
  return { format: BUNDLE_FORMAT, version: 1, createdAt: '2026-09-03T00:00:00.000Z', createdBy: 'toksight', files };
}

// ---------------------------------------------------------------------------
// Export

test('export bundles existing config files verbatim and never credentials', async () => {
  const { home, svc } = setup();
  write(path.join(home, '.claude', 'settings.json'), '{"model":"claude-haiku-4.5","env":{"ANTHROPIC_API_KEY":"claude-secret"}}');
  write(path.join(home, '.claude', '.credentials.json'), '{"token":"never-export-me"}');
  write(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5"\n');

  const { bundle, warnings } = await svc.exportBundle();
  assert.deepEqual(warnings, []);
  assert.equal(bundle.format, BUNDLE_FORMAT);
  assert.equal(bundle.version, 1);
  assert.equal(bundle.createdBy, 'toksight');

  const ids = bundle.files.map((file) => file.id).sort();
  assert.deepEqual(ids, ['claude.settings', 'codex.config']); // no claude.credentials

  const claude = bundle.files.find((file) => file.id === 'claude.settings');
  // Export is a migration tool: config file content travels UNREDACTED
  // (that includes provider keys the user configured). Credential files
  // (OAuth stores, auth.json) are excluded wholesale — those never leave.
  assert.equal(claude.content, '{"model":"claude-haiku-4.5","env":{"ANTHROPIC_API_KEY":"claude-secret"}}');
  assert.equal(claude.agentId, 'claude');
  assert.equal(claude.fileName, 'settings.json');
  assert.equal(claude.path, path.join(home, '.claude', 'settings.json'));
  assert.ok(claude.modifiedAt);
});

test('export filters by agent and file id, and skips oversized files with a warning', async () => {
  const { home, svc } = setup();
  write(path.join(home, '.claude', 'settings.json'), '{}');
  write(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5"\n');
  const big = path.join(home, '.kimi-code', 'config.toml');
  write(big, 'x'.repeat(1024 * 1024 + 1));

  const byAgent = await svc.exportBundle({ agents: 'codex' });
  assert.deepEqual(byAgent.bundle.files.map((file) => file.id), ['codex.config']);

  const byFiles = await svc.exportBundle({ files: ['claude.settings'] });
  assert.deepEqual(byFiles.bundle.files.map((file) => file.id), ['claude.settings']);

  const all = await svc.exportBundle();
  assert.deepEqual(all.bundle.files.map((file) => file.id).sort(), ['claude.settings', 'codex.config']);
  assert.equal(all.warnings.length, 1);
  assert.match(all.warnings[0], /kimi\.config.*larger than 1 MB/);
});

test('export ignores files that do not exist', async () => {
  const { svc } = setup();
  const { bundle, warnings } = await svc.exportBundle();
  assert.deepEqual(bundle.files, []);
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------------------
// planImport

test('plan resolves targets on THIS machine and flags existing files for backup', async () => {
  const { home, configRoot, svc } = setup();
  write(path.join(home, '.claude', 'settings.json'), '{"model":"old"}');

  const { error, plan, warnings } = await svc.planImport(bundleOf([entry()]));
  assert.equal(error, null);
  assert.deepEqual(warnings, []);
  assert.equal(plan.length, 1);

  const row = plan[0];
  // The bundle's recorded source path is informational only — the write
  // target is resolved from THIS machine's allowlist.
  assert.equal(row.targetPath, path.join(home, '.claude', 'settings.json'));
  assert.equal(row.sourcePath, '/somewhere/else/settings.json');
  assert.equal(row.action, 'write');
  assert.equal(row.existing, true);
  assert.equal(row.existingSize, Buffer.byteLength('{"model":"old"}'));
  assert.equal(row.reason, null);
  assert.ok(row.backupPath.startsWith(path.join(configRoot, 'backups', 'claude', 'settings.json.')));
});

test('plan marks fresh targets without a backup', async () => {
  const { home, svc } = setup();
  const { plan } = await svc.planImport(bundleOf([entry()]));
  const row = plan[0];
  assert.equal(row.action, 'write');
  assert.equal(row.existing, false);
  assert.equal(row.backupPath, null);
  assert.equal(path.dirname(row.targetPath), path.join(home, '.claude'));
});

test('plan rejects credential ids, unknown ids and bad content', async () => {
  const { svc } = setup();
  const { plan, warnings } = await svc.planImport(
    bundleOf([
      entry({ id: 'claude.credentials' }), // credential id — never importable
      entry({ id: 'no.such.file' }), // unknown id
      entry({ content: 42 }), // content must be a string
      entry({ id: 'kimi.config', content: 'x'.repeat(1024 * 1024 + 1) }), // oversize
      { id: 'codex.config' }, // malformed: no content field at all
    ]),
  );
  assert.deepEqual(warnings, []);
  const byReason = Object.fromEntries(plan.map((row) => [row.id, row.reason]));
  assert.equal(byReason['claude.credentials'], 'secret');
  assert.equal(byReason['no.such.file'], 'unknown-id');
  assert.equal(byReason['claude.settings'], 'no-content');
  assert.equal(byReason['kimi.config'], 'oversize');
  assert.equal(byReason['codex.config'], 'no-content');
  assert.equal(plan.every((row) => row.action === 'skip'), true);
  assert.equal(plan.every((row) => row.targetPath === null), true);
});

test('plan honors the selected filter and flags blocked targets', async () => {
  const { home, svc } = setup();
  write(path.join(home, '.claude', 'settings.json'), '{}');
  // A directory sitting where the target file would go: import must refuse.
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex', 'config.toml'), { recursive: true });

  const { plan } = await svc.planImport(
    bundleOf([entry(), entry({ id: 'codex.config', content: 'model = "gpt-5"' }), entry({ id: 'kimi.config', content: 'x = 1' })]),
    { selected: ['claude.settings', 'codex.config'] },
  );

  const claude = plan.find((row) => row.id === 'claude.settings');
  assert.equal(claude.action, 'write');

  const codex = plan.find((row) => row.id === 'codex.config');
  assert.equal(codex.action, 'skip');
  assert.equal(codex.reason, 'target-not-file');

  const kimi = plan.find((row) => row.id === 'kimi.config');
  assert.equal(kimi.action, 'skip');
  assert.equal(kimi.reason, 'not-selected');
});

test('plan validates the bundle shape and dedupes repeated ids', async () => {
  const { svc } = setup();
  assert.equal((await svc.planImport(null)).error.includes('JSON object'), true);
  assert.equal((await svc.planImport({ format: 'zip', version: 1, files: [] })).error.includes('not a'), true);
  assert.equal((await svc.planImport({ format: BUNDLE_FORMAT, version: 99, files: [] })).error.includes('version'), true);
  assert.equal((await svc.planImport({ format: BUNDLE_FORMAT, version: 1, files: 'no' })).error.includes('array'), true);

  const { plan, warnings } = await svc.planImport(bundleOf([entry({ content: 'first' }), entry({ content: 'second' })]));
  assert.equal(plan.length, 1);
  assert.equal(plan[0].contentBytes, Buffer.byteLength('first'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /duplicate/);
});

// ---------------------------------------------------------------------------
// applyImport

test('apply writes new files, creating parent directories', async () => {
  const { home, svc } = setup();
  const { results } = await svc.applyImport(bundleOf([entry()]));
  assert.deepEqual(results, [{
    id: 'claude.settings',
    agentId: 'claude',
    status: 'written',
    reason: null,
    targetPath: path.join(home, '.claude', 'settings.json'),
    backupPath: null,
    error: null,
  }]);
  assert.equal(read(path.join(home, '.claude', 'settings.json')), JSON.stringify({ model: 'claude-haiku-4.5' }));
});

test('apply backs up an existing file before replacing it', async () => {
  const { home, configRoot, svc } = setup();
  const target = path.join(home, '.claude', 'settings.json');
  write(target, '{"model":"old-value"}');

  const { results } = await svc.applyImport(bundleOf([entry()]));
  assert.equal(results[0].status, 'written');
  const backupPath = results[0].backupPath;
  assert.ok(backupPath.startsWith(path.join(configRoot, 'backups', 'claude', 'settings.json.')));
  assert.equal(read(backupPath), '{"model":"old-value"}');
  assert.equal(read(target), JSON.stringify({ model: 'claude-haiku-4.5' }));
});

test('apply never writes credentials or unknown ids, respects selection', async () => {
  const { home, svc } = setup();
  const { results } = await svc.applyImport(
    bundleOf([
      entry({ id: 'claude.credentials', content: '{"token":"evil"}' }),
      entry({ id: 'no.such.file', content: 'evil' }),
      entry({ id: 'kimi.config', content: 'x = 1' }),
    ]),
    { selected: ['kimi.config'] },
  );

  assert.deepEqual(results.map((row) => [row.id, row.status, row.reason]).sort(), [
    ['claude.credentials', 'skipped', 'secret'],
    ['kimi.config', 'written', null],
    ['no.such.file', 'skipped', 'unknown-id'],
  ]);
  assert.equal(read(path.join(home, '.kimi-code', 'config.toml')), 'x = 1');
  assert.equal(fs.existsSync(path.join(home, '.claude')), false);
  assert.equal(fs.existsSync(path.join(home, '.claude.json')), false);
});

test('apply reports per-file failures without aborting the rest', async () => {
  const { home, svc } = setup();
  // <home>/.claude is a FILE, so claude.settings cannot be written (its
  // parent directory cannot be created) — while codex.config succeeds.
  write(path.join(home, '.claude'), 'blocking file');

  const { results } = await svc.applyImport(bundleOf([
    entry(),
    entry({ id: 'codex.config', content: 'model = "gpt-5"' }),
  ]));
  const claude = results.find((row) => row.id === 'claude.settings');
  assert.equal(claude.status, 'failed');
  assert.ok(claude.error);
  const codex = results.find((row) => row.id === 'codex.config');
  assert.equal(codex.status, 'written');
  assert.equal(read(path.join(home, '.codex', 'config.toml')), 'model = "gpt-5"');
});

test('apply refuses to replace a target that is a directory', async () => {
  const { home, svc } = setup();
  fs.mkdirSync(path.join(home, '.codex', 'config.toml'), { recursive: true });

  const { results } = await svc.applyImport(bundleOf([entry({ id: 'codex.config', content: 'model = "gpt-5"' })]));
  assert.equal(results[0].status, 'failed');
  assert.equal(results[0].reason, 'target-not-file');
  assert.equal(fs.statSync(path.join(home, '.codex', 'config.toml')).isDirectory(), true);
});

test('a bundle survives a full round trip: export here, import there', async () => {
  const source = setup();
  const original = 'default_model = "kimi-code/k3"\n[providers."managed:kimi-code"]\ntype = "kimi"\napi_key = "keep-me"\n';
  write(path.join(source.home, '.kimi-code', 'config.toml'), original);

  const { bundle } = await source.svc.exportBundle({ agents: 'kimi' });
  assert.deepEqual(bundle.files.map((file) => file.id), ['kimi.config']);

  const target = setup();
  write(path.join(target.home, '.kimi-code', 'config.toml'), 'default_model = "old"\n');

  const { results } = await target.svc.applyImport(bundle);
  assert.equal(results[0].status, 'written');
  assert.equal(read(path.join(target.home, '.kimi-code', 'config.toml')), original);
  // The previous content was backed up before the swap.
  assert.equal(read(results[0].backupPath), 'default_model = "old"\n');
});

test('importing the same bundle twice produces distinct backups', async () => {
  const { home, configRoot, svc } = setup();
  const target = path.join(home, '.claude', 'settings.json');
  write(target, '{"model":"first"}');

  const first = await svc.applyImport(bundleOf([entry()]));
  const second = await svc.applyImport(bundleOf([entry()]));
  assert.notEqual(first.results[0].backupPath, second.results[0].backupPath);
  assert.equal(read(first.results[0].backupPath), '{"model":"first"}');
  assert.equal(read(second.results[0].backupPath), JSON.stringify({ model: 'claude-haiku-4.5' }));
  // Both backups live under <config>/toksight/backups/claude/.
  for (const result of [first.results[0], second.results[0]]) {
    assert.equal(path.dirname(result.backupPath), path.join(configRoot, 'backups', 'claude'));
  }
});

// ---------------------------------------------------------------------------
// Failure hygiene (PR #8 review follow-ups)

test('a failed write cleans up its temp file and reports the created backup', async () => {
  const { home, configRoot, svc } = setup();
  const target = path.join(home, '.claude', 'settings.json');
  const dir = path.join(home, '.claude');
  write(target, '{"model":"old-value"}');
  // Force the write to fail per platform: on Windows a read-only target
  // makes rename fail with EPERM; on POSIX an unwritable parent directory
  // makes writeFile fail with EACCES. Both scenarios back up the existing
  // target BEFORE the failing step, then hit the catch.
  if (process.platform === 'win32') {
    fs.chmodSync(target, 0o444);
  } else {
    fs.chmodSync(dir, 0o555);
  }
  try {
    const { results } = await svc.applyImport(bundleOf([entry()]));
    const row = results[0];
    assert.equal(row.status, 'failed');
    assert.ok(row.error);
    // The backup happened before the failure and is reported on the row.
    assert.ok(row.backupPath.startsWith(path.join(configRoot, 'backups', 'claude')));
    assert.equal(read(row.backupPath), '{"model":"old-value"}');
    // The target was never replaced, and no temp file leaked next to it.
    assert.equal(read(target), '{"model":"old-value"}');
    assert.equal(fs.readdirSync(dir).some((name) => name.includes('toksight-tmp')), false);
  } finally {
    fs.chmodSync(target, 0o644);
    if (process.platform !== 'win32') fs.chmodSync(dir, 0o755);
  }
});

test('plan and apply refuse to write through a symlinked target', async (t) => {
  const { home, svc } = setup();
  const real = path.join(home, 'real-settings.json');
  write(real, '{"model":"old"}');
  const dir = path.join(home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  const link = path.join(dir, 'settings.json');
  try {
    fs.symlinkSync(real, link);
  } catch (err) {
    t.skip(`symlinks unavailable here (${err?.code || err})`);
    return;
  }

  // rename replaces the target's own directory entry, so a symlinked target
  // must never be offered for writing — the plan flags it as blocked.
  const { plan } = await svc.planImport(bundleOf([entry()]));
  assert.equal(plan[0].action, 'skip');
  assert.equal(plan[0].reason, 'target-not-file');

  const { results } = await svc.applyImport(bundleOf([entry()]));
  assert.equal(results[0].status, 'failed');
  assert.equal(results[0].reason, 'target-not-file');

  // The link itself is untouched and still resolves to the real file.
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(read(link), '{"model":"old"}');
  assert.equal(fs.readdirSync(dir).some((name) => name.includes('toksight-tmp')), false);
});

test('import targets resolve under relocated agent homes', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-transfer-env-'));
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-transfer-config-'));
  const env = {
    TOKSIGHT_CONFIG_DIR: configRoot,
    ZCODE_HOME: path.join(home, 'z'),
    CLAUDE_CONFIG_DIR: path.join(home, 'c'),
    CODEX_HOME: path.join(home, 'x'),
    KIMI_CODE_HOME: path.join(home, 'k'),
    OPENCODE_CONFIG_DIR: path.join(home, 'oc'),
  };
  const svc = createAgentTransferService({ env, home });

  const { plan } = await svc.planImport(bundleOf([
    entry(),
    entry({ id: 'codex.config', content: 'x = 1' }),
    entry({ id: 'kimi.config', content: 'x = 1' }),
    entry({ id: 'zcode.providers', content: '{}' }),
    entry({ id: 'opencode.config-json', content: '{}' }),
  ]));
  const target = Object.fromEntries(plan.map((row) => [row.id, row.targetPath]));
  assert.equal(target['claude.settings'], path.join(env.CLAUDE_CONFIG_DIR, 'settings.json'));
  assert.equal(target['codex.config'], path.join(env.CODEX_HOME, 'config.toml'));
  assert.equal(target['kimi.config'], path.join(env.KIMI_CODE_HOME, 'config.toml'));
  assert.equal(target['zcode.providers'], path.join(env.ZCODE_HOME, 'v2', 'config.json'));
  assert.equal(target['opencode.config-json'], path.join(env.OPENCODE_CONFIG_DIR, 'opencode.json'));
});

test('bundle entries carrying unknown extra fields import fine (forward compat)', async () => {
  const { home, svc } = setup();
  const { results } = await svc.applyImport(bundleOf([
    { ...entry(), checksum: 'abc', futureField: { nested: ['deep'] } },
  ]));
  assert.equal(results[0].status, 'written');
  assert.equal(read(path.join(home, '.claude', 'settings.json')), JSON.stringify({ model: 'claude-haiku-4.5' }));
});

test('export warns when an allowlisted path is not a regular file', async () => {
  const { home, svc } = setup();
  fs.mkdirSync(path.join(home, '.codex', 'config.toml'), { recursive: true });
  const { bundle, warnings } = await svc.exportBundle();
  assert.deepEqual(bundle.files, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /codex\.config.*not a regular file/);
});

test('apply reports duplicate-entry warnings like the plan does', async () => {
  const { home, svc } = setup();
  const { results, warnings } = await svc.applyImport(bundleOf([entry({ content: 'first' }), entry({ content: 'second' })]));
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'written');
  assert.equal(read(path.join(home, '.claude', 'settings.json')), 'first');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /duplicate/);
});
