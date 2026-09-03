import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createAgentConfigService, redactConfig } from '../src/agentconfigs.js';

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-config-'));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function findItem(inventory, id) {
  return inventory.agents.flatMap((agent) => agent.files).find((item) => item.id === id);
}

function findAgent(inventory, id) {
  return inventory.agents.find((agent) => agent.id === id);
}

test('inventory covers the five agents with summaries, files and redacted previews', async () => {
  const home = tempHome();
  write(
    path.join(home, '.claude', 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      model: 'claude-haiku-4.5',
      env: { ANTHROPIC_API_KEY: 'claude-secret', ANTHROPIC_BASE_URL: 'https://relay.example.test', ANTHROPIC_MODEL: 'claude-haiku-4.5' },
    }),
  );
  write(path.join(home, '.claude.json'), JSON.stringify({ installMethod: 'native', mcpServers: { fetch: {} } }));
  write(
    path.join(home, '.codex', 'config.toml'),
    'model = "gpt-5"\nmodel_reasoning_effort = "high"\napproval_policy = "never"\n',
  );
  write(path.join(home, '.codex', 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'codex-token' } }));
  write(path.join(home, '.codex', '.env'), 'HTTP_PROXY=http://127.0.0.1:7897\n');
  write(path.join(home, '.codex', 'fast.config.toml'), 'model = "gpt-5-mini"\n');
  write(
    path.join(home, '.config', 'opencode', 'opencode.jsonc'),
    '{\n  "model": "rhythm/glm-5.3",\n  "provider": {\n    "rhythm": {\n      "options": { "baseURL": "https://tokenrhythm.studio/v1", "apiKey": "opencode-secret" },\n      "models": { "glm-5.3": {} }\n    }\n  },\n  "mcp": { "demo": {} }\n}\n',
  );
  write(
    path.join(home, '.kimi-code', 'config.toml'),
    [
      'default_model = "kimi-code/k3"',
      'default_permission_mode = "yolo"',
      '[providers."managed:kimi-code"]',
      'type = "kimi"',
      'base_url = "https://api.kimi.com/coding/v1"',
      '[models."kimi-code/k3"]',
      'provider = "managed:kimi-code"',
      'max_context_size = 1048576',
    ].join('\n'),
  );
  write(path.join(home, '.kimi-code', 'region'), 'mainland-cn');
  write(path.join(home, '.kimi-code', 'credentials', 'kimi-code.json'), JSON.stringify({ access_token: 'kimi-secret' }));
  write(path.join(home, '.zcode', 'v2', 'config.json'), JSON.stringify({ provider: { 'builtin:zai': { kind: 'anthropic', options: { baseURL: 'https://api.z.ai/api/anthropic', apiKey: 'zcode-secret' }, models: { 'GLM-5.3': { limit: { context: 128000 } } } } } }));
  write(path.join(home, '.zcode', 'v2', 'credentials.json'), JSON.stringify({ 'oauth:zai:access_token': 'zcode-oauth-secret' }));

  const inventory = await createAgentConfigService({ env: {}, home }).inspect();
  assert.deepEqual(inventory.agents.map(({ id }) => id), ['zcode', 'claude', 'codex', 'opencode', 'kimi']);

  // Claude: env is walked into — the endpoint/model survive, the key does not.
  const claude = findAgent(inventory, 'claude');
  assert.equal(claude.summary.defaultModel, 'claude-haiku-4.5');
  assert.deepEqual(claude.summary.auth, { method: 'envKey', detail: 'ANTHROPIC_API_KEY' });
  const claudeEnvFacts = claude.summary.facts.filter((fact) => fact.key.startsWith('ANTHROPIC_'));
  assert.ok(claudeEnvFacts.some((fact) => fact.key === 'ANTHROPIC_BASE_URL' && fact.value === 'https://relay.example.test'));
  assert.ok(claudeEnvFacts.some((fact) => fact.key === 'ANTHROPIC_MODEL'));
  assert.ok(!claudeEnvFacts.some((fact) => fact.key === 'ANTHROPIC_API_KEY'));
  assert.deepEqual(claude.summary.mcpServers, ['fetch']);
  const claudePreview = findItem(inventory, 'claude.settings').preview;
  assert.match(claudePreview, /ANTHROPIC_BASE_URL/);
  assert.match(claudePreview, /relay\.example\.test/);
  assert.doesNotMatch(claudePreview, /claude-secret/);
  assert.match(claudePreview, /REDACTED/);

  // Codex: summary facts, ChatGPT auth, profile discovery, .env names.
  const codex = findAgent(inventory, 'codex');
  assert.equal(codex.summary.defaultModel, 'gpt-5 · high');
  assert.deepEqual(codex.summary.auth, { method: 'chatgpt', detail: null });
  const codexFact = (key) => codex.summary.facts.find((fact) => fact.key === key)?.value;
  assert.equal(codexFact('factApproval'), 'never');
  assert.equal(codexFact('factProfiles'), 'fast');
  assert.equal(codexFact('factEnvFile'), 'HTTP_PROXY');

  // OpenCode: provider table + auth key from the data-dir auth.json.
  const opencode = findAgent(inventory, 'opencode');
  assert.equal(opencode.summary.defaultModel, 'rhythm/glm-5.3');
  assert.deepEqual(opencode.summary.providers, [{
    name: 'rhythm', kind: null, baseURL: 'https://tokenrhythm.studio/v1',
    apiKeySet: true, authVia: 'key', enabled: null, modelCount: 1,
  }]);
  assert.deepEqual(opencode.summary.mcpServers, ['demo']);

  // Kimi: default model, region fact, provider without an API key.
  const kimi = findAgent(inventory, 'kimi');
  assert.equal(kimi.summary.defaultModel, 'kimi-code/k3');
  const kimiFact = (key) => kimi.summary.facts.find((fact) => fact.key === key)?.value;
  assert.equal(kimiFact('factPermissionMode'), 'yolo');
  assert.equal(kimiFact('factRegion'), 'mainland-cn');
  assert.equal(kimi.summary.providers[0].name, 'managed:kimi-code');
  assert.equal(kimi.summary.providers[0].apiKeySet, false);
  assert.equal(kimi.summary.models[0].contextTokens, 1048576);

  // ZCode: provider/models flattened from v2/config.json, oauth detected.
  const zcode = findAgent(inventory, 'zcode');
  assert.equal(zcode.summary.providers[0].name, 'builtin:zai');
  assert.equal(zcode.summary.providers[0].modelCount, 1);
  assert.deepEqual(zcode.summary.models, [{ name: 'GLM-5.3', provider: 'builtin:zai', contextTokens: 128000 }]);
  assert.deepEqual(zcode.summary.auth, { method: 'oauth', detail: 'z.ai' });

  // Secrets never appear anywhere in the serialized inventory.
  const json = JSON.stringify(inventory);
  for (const secret of ['claude-secret', 'codex-token', 'opencode-secret', 'kimi-secret', 'zcode-secret', 'zcode-oauth-secret']) {
    assert.ok(!json.includes(secret), `${secret} leaked into the inventory`);
  }
});

test('credential files report metadata but never produce a preview', async () => {
  const home = tempHome();
  write(path.join(home, '.codex', 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'codex-secret', tokens: { access_token: 't' } }));
  write(path.join(home, '.claude', '.credentials.json'), JSON.stringify({ ANTHROPIC_API_KEY: 'claude-secret' }));

  const inventory = await createAgentConfigService({ env: {}, home }).inspect();
  const codexAuth = findItem(inventory, 'codex.auth');
  assert.equal(codexAuth.exists, true);
  assert.equal(codexAuth.preview, null);
  assert.equal(codexAuth.previewable, false);
  const claudeCreds = findItem(inventory, 'claude.credentials');
  assert.equal(claudeCreds.exists, true);
  assert.equal(claudeCreds.preview, null);

  // Claude with a credentials file reports OAuth, not the env-key fallback.
  const claude = findAgent(inventory, 'claude');
  assert.equal(claude.summary.auth.method, 'oauth');
  assert.ok(!JSON.stringify(inventory).includes('claude-secret'));
  assert.ok(!JSON.stringify(inventory).includes('codex-secret'));
});

test('inventory honors each supported agent home override', async () => {
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
  // CLAUDE_CONFIG_DIR relocates .claude.json too.
  assert.equal(findItem(inventory, 'claude.state').path, path.join(roots.CLAUDE_CONFIG_DIR, '.claude.json'));
  assert.equal(findItem(inventory, 'codex.config').path, path.join(roots.CODEX_HOME, 'config.toml'));
  assert.equal(findItem(inventory, 'opencode.config-json').path, path.join(roots.OPENCODE_CONFIG_DIR, 'opencode.json'));
  assert.equal(findItem(inventory, 'opencode.auth').path, path.join(home, '.local', 'share', 'opencode', 'auth.json'));
  assert.equal(findItem(inventory, 'kimi.config').path, path.join(roots.KIMI_CODE_HOME, 'config.toml'));

  const customOpenCode = path.join(home, 'elsewhere', 'custom.jsonc');
  const customInventory = await createAgentConfigService({
    env: { ...roots, OPENCODE_CONFIG: customOpenCode },
    home,
  }).inspect();
  assert.equal(findItem(customInventory, 'opencode.config-jsonc').path, customOpenCode);
});

test('missing and malformed files degrade to warnings without throwing', async () => {
  const home = tempHome();
  write(path.join(home, '.claude', 'settings.json'), '{ not json');
  write(path.join(home, '.kimi-code', 'config.toml'), 'default_model = "k3"\nbroken = [1, 2\n');

  const inventory = await createAgentConfigService({ env: {}, home }).inspect();
  const claudeSettings = findItem(inventory, 'claude.settings');
  assert.equal(claudeSettings.exists, true);
  assert.ok(inventory.warnings.some((warning) => warning.includes('cannot parse')));
  // A malformed JSON config still yields a line-redacted preview.
  assert.match(claudeSettings.preview, /not json/);
  const kimi = findAgent(inventory, 'kimi');
  assert.equal(kimi.summary.defaultModel, 'k3');
  assert.ok(inventory.warnings.some((warning) => warning.includes('.kimi-code')));
});

test('oversized files keep metadata only and warn', async () => {
  const home = tempHome();
  write(path.join(home, '.kimi-code', 'mcp.json'), 'x'.repeat(1024 * 1024 + 1));
  const inventory = await createAgentConfigService({ env: {}, home }).inspect();
  const item = findItem(inventory, 'kimi.mcp');
  assert.equal(item.exists, true);
  assert.equal(item.preview, null);
  assert.equal(item.truncated, true);
  assert.ok(inventory.warnings.some((warning) => warning.includes('larger than 1 MB')));
});

test('redactConfig handles json, jsonc, toml and free text', () => {
  const json = redactConfig('{"apiKey":"a","nested":{"token":"b"},"baseURL":"https://x.test"}', 'json');
  assert.match(json, /REDACTED/);
  assert.doesNotMatch(json, /"a"|"b"/);
  assert.match(json, /baseURL/);

  const jsonc = redactConfig('{\n  // c\n  "apiKey": "x",\n  "theme": "dark",\n}', 'jsonc');
  assert.match(jsonc, /theme/);
  assert.match(jsonc, /REDACTED/);

  const toml = redactConfig('[providers.p]\napi_key = "s"\nbase_url = "https://x.test"\n', 'toml');
  assert.doesNotMatch(toml, /= "s"/);
  assert.match(toml, /base_url/);

  const text = redactConfig('export K=v\nhttps://user:pass@x.test/a?token=q\n', 'text');
  assert.match(text, /REDACTED/);
  assert.doesNotMatch(text, /pass@/);
});
