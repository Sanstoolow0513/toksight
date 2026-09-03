import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CONFIG_BUNDLE_FORMAT,
  CONFIG_BUNDLE_VERSION,
  MAX_CONFIG_BYTES,
  createAgentConfigService,
} from '../src/agentconfigs.js';

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-config-'));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function findItem(inventory, id) {
  return inventory.agents.flatMap((agent) => agent.items).find((item) => item.id === id);
}

test('config inventory is limited to five agents and redacts preview secrets', async () => {
  const home = tempHome();
  write(
    path.join(home, '.claude', 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      env: { ANTHROPIC_API_KEY: 'claude-secret' },
      apiKey: 'second-secret',
      token: 'bare-token-secret',
      endpoint: 'https://user:url-password@example.test/run?token=query-secret',
    }),
  );
  write(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5"\napi_key = "codex-secret"\n');
  write(
    path.join(home, '.config', 'opencode', 'opencode.jsonc'),
    '// local settings\n{\n  "headers": [\n    "jsonc-secret"\n  ],\n  "theme": "dark"\n}\n',
  );

  const inventory = await createAgentConfigService({ env: {}, home }).inspect();
  assert.deepEqual(
    inventory.agents.map(({ id }) => id),
    ['zcode', 'claude', 'codex', 'opencode', 'kimi'],
  );
  assert.equal(inventory.agents.length, 5);

  const claude = findItem(inventory, 'claude.settings');
  assert.equal(claude.exists, true);
  assert.match(claude.preview, /dark/);
  assert.doesNotMatch(claude.preview, /claude-secret|second-secret|bare-token-secret|url-password|query-secret/);
  assert.match(claude.preview, /REDACTED/);

  const codex = findItem(inventory, 'codex.config');
  assert.match(codex.preview, /gpt-5/);
  assert.doesNotMatch(codex.preview, /codex-secret/);
  const openCode = findItem(inventory, 'opencode.config-jsonc');
  assert.match(openCode.preview, /dark/);
  assert.doesNotMatch(openCode.preview, /jsonc-secret/);
  assert.equal(findItem(inventory, 'kimi.config').exists, false);
});

test('export manifest packages only selected files and adds no absolute paths', async () => {
  const home = tempHome();
  const claudeRaw = '{"theme":"dark","apiKey":"exported-secret"}\n';
  const codexRaw = 'model = "gpt-5"\n';
  write(path.join(home, '.claude', 'settings.json'), claudeRaw);
  write(path.join(home, '.codex', 'config.toml'), codexRaw);

  const service = createAgentConfigService({ env: {}, home, now: () => Date.UTC(2026, 8, 2, 12, 30) });
  const bundle = await service.exportBundle(['codex.config', 'claude.settings']);
  assert.equal(bundle.format, CONFIG_BUNDLE_FORMAT);
  assert.equal(bundle.version, CONFIG_BUNDLE_VERSION);
  assert.equal(bundle.createdAt, '2026-09-02T12:30:00.000Z');
  assert.deepEqual(bundle.items.map(({ id }) => id), ['codex.config', 'claude.settings']);
  assert.equal(bundle.items[0].content, codexRaw);
  assert.equal(bundle.items[1].content, claudeRaw);
  assert.ok(bundle.items.every((item) => !Object.hasOwn(item, 'path')));
  assert.doesNotMatch(JSON.stringify(bundle), new RegExp(home.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));

  await assert.rejects(() => service.exportBundle(['kimi.config']), /does not exist/);
  await assert.rejects(() => service.exportBundle(['cursor.settings']), /unsupported configuration item/);
});

test('config inventory honors each supported agent home override', async () => {
  const home = tempHome();
  const roots = {
    ZCODE_HOME: path.join(home, 'zcode-home'),
    CLAUDE_CONFIG_DIR: path.join(home, 'claude-home'),
    CODEX_HOME: path.join(home, 'codex-home'),
    OPENCODE_CONFIG_DIR: path.join(home, 'opencode-home'),
    KIMI_CODE_HOME: path.join(home, 'kimi-home'),
  };
  const inventory = await createAgentConfigService({ env: roots, home }).inspect();
  assert.equal(findItem(inventory, 'zcode.providers').path, path.join(roots.ZCODE_HOME, 'v2', 'config.json'));
  assert.equal(findItem(inventory, 'claude.settings').path, path.join(roots.CLAUDE_CONFIG_DIR, 'settings.json'));
  assert.equal(findItem(inventory, 'codex.config').path, path.join(roots.CODEX_HOME, 'config.toml'));
  assert.equal(findItem(inventory, 'opencode.config-json').path, path.join(roots.OPENCODE_CONFIG_DIR, 'opencode.json'));
  assert.equal(findItem(inventory, 'kimi.config').path, path.join(roots.KIMI_CODE_HOME, 'config.toml'));

  const customOpenCode = path.join(home, 'elsewhere', 'custom.jsonc');
  const customInventory = await createAgentConfigService({
    env: { ...roots, OPENCODE_CONFIG: customOpenCode },
    home,
  }).inspect();
  assert.equal(findItem(customInventory, 'opencode.config-jsonc').path, customOpenCode);
});

test('oversized configuration can be previewed but cannot be exported', async () => {
  const home = tempHome();
  write(path.join(home, '.kimi-code', 'mcp.json'), 'x'.repeat(MAX_CONFIG_BYTES + 1));
  const service = createAgentConfigService({ env: {}, home });
  const inventory = await service.inspect();
  const item = findItem(inventory, 'kimi.mcp');
  assert.equal(item.exists, true);
  assert.equal(item.exportable, false);
  assert.equal(item.truncated, true);
  await assert.rejects(() => service.exportBundle(['kimi.mcp']), /larger than/);
});

test('bundle preview verifies checksums and never exposes raw secrets', async () => {
  const home = tempHome();
  write(path.join(home, '.kimi-code', 'config.toml'), 'model = "kimi"\napi_key = "moon-secret"\n');
  const service = createAgentConfigService({ env: {}, home });
  const bundle = await service.exportBundle(['kimi.config']);
  const preview = await service.previewBundle(bundle);

  assert.equal(preview.items[0].destinationExists, true);
  assert.match(preview.items[0].preview, /kimi/);
  assert.doesNotMatch(preview.items[0].preview, /moon-secret/);
  assert.match(preview.items[0].preview, /REDACTED/);

  const tampered = structuredClone(bundle);
  tampered.items[0].content += '# changed';
  await assert.rejects(() => service.previewBundle(tampered), /checksum mismatch/);

  const unsupported = structuredClone(bundle);
  unsupported.items[0].id = 'cursor.settings';
  await assert.rejects(() => service.previewBundle(unsupported), /unsupported configuration item/);
});

test('selective import backs up an existing target before installing', async () => {
  const sourceHome = tempHome();
  write(path.join(sourceHome, '.codex', 'config.toml'), 'model = "new-codex"\n');
  write(path.join(sourceHome, '.claude', 'settings.json'), '{"theme":"new-claude"}\n');
  const bundle = await createAgentConfigService({ env: {}, home: sourceHome }).exportBundle([
    'codex.config',
    'claude.settings',
  ]);

  const targetHome = tempHome();
  const codexPath = path.join(targetHome, '.codex', 'config.toml');
  const claudePath = path.join(targetHome, '.claude', 'settings.json');
  write(codexPath, 'model = "old-codex"\n');
  write(claudePath, '{"theme":"old-claude"}\n');
  write(`${codexPath}.backup-20260902T123045Z`, 'older backup\n');
  const target = createAgentConfigService({
    env: {},
    home: targetHome,
    now: () => Date.UTC(2026, 8, 2, 12, 30, 45),
  });

  const result = await target.importBundle(bundle, ['codex.config']);
  assert.equal(fs.readFileSync(codexPath, 'utf8'), 'model = "new-codex"\n');
  assert.equal(fs.readFileSync(claudePath, 'utf8'), '{"theme":"old-claude"}\n');
  assert.deepEqual(result.imported, [{ id: 'codex.config', path: codexPath }]);
  assert.equal(result.backups.length, 1);
  assert.match(result.backups[0].backupPath, /config\.toml\.backup-20260902T123045Z-2$/);
  assert.equal(fs.readFileSync(result.backups[0].backupPath, 'utf8'), 'model = "old-codex"\n');
});

test('import creates missing parent directories and rejects selections outside the bundle', async () => {
  const sourceHome = tempHome();
  write(path.join(sourceHome, '.kimi-code', 'tui.toml'), 'theme = "dark"\n');
  const bundle = await createAgentConfigService({ env: {}, home: sourceHome }).exportBundle(['kimi.tui']);

  const targetHome = tempHome();
  const injectedPath = path.join(targetHome, 'attacker-selected-path.toml');
  bundle.items[0].path = injectedPath;
  const target = createAgentConfigService({ env: {}, home: targetHome });
  const result = await target.importBundle(bundle, ['kimi.tui']);
  assert.equal(result.backups.length, 0);
  assert.equal(fs.readFileSync(path.join(targetHome, '.kimi-code', 'tui.toml'), 'utf8'), 'theme = "dark"\n');
  assert.equal(fs.existsSync(injectedPath), false);

  await assert.rejects(() => target.importBundle(bundle, ['codex.config']), /not in the bundle/);
  await assert.rejects(() => target.importBundle(bundle, ['kimi.tui', 'kimi.tui']), /unique configuration IDs/);
});

test('import refuses to displace a directory at a configuration path', async () => {
  const sourceHome = tempHome();
  write(path.join(sourceHome, '.kimi-code', 'tui.toml'), 'theme = "dark"\n');
  const bundle = await createAgentConfigService({ env: {}, home: sourceHome }).exportBundle(['kimi.tui']);

  const targetHome = tempHome();
  const targetPath = path.join(targetHome, '.kimi-code', 'tui.toml');
  fs.mkdirSync(targetPath, { recursive: true });
  const target = createAgentConfigService({ env: {}, home: targetHome });
  const preview = await target.previewBundle(bundle);
  assert.equal(preview.items[0].importable, false);
  await assert.rejects(() => target.importBundle(bundle, ['kimi.tui']), /destination is not a file/);
  assert.equal(fs.statSync(targetPath).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(path.dirname(targetPath)), ['tui.toml']);
});

test('import rejects two selected IDs that resolve to one destination', async () => {
  const sourceHome = tempHome();
  const sourceConfigHome = path.join(sourceHome, 'shared-config');
  const sharedSource = path.join(sourceConfigHome, 'config.toml');
  write(sharedSource, 'model = "shared"\n');
  const source = createAgentConfigService({
    home: sourceHome,
    env: { CODEX_HOME: sourceConfigHome, KIMI_CODE_HOME: sourceConfigHome },
  });
  const bundle = await source.exportBundle(['codex.config', 'kimi.config']);

  const targetHome = tempHome();
  const targetConfigHome = path.join(targetHome, 'shared-config');
  const sharedTarget = path.join(targetConfigHome, 'config.toml');
  const target = createAgentConfigService({
    home: targetHome,
    env: { CODEX_HOME: targetConfigHome, KIMI_CODE_HOME: targetConfigHome },
  });
  await assert.rejects(
    () => target.importBundle(bundle, ['codex.config', 'kimi.config']),
    /resolve to the same destination/,
  );
  assert.equal(fs.existsSync(sharedTarget), false);
});
