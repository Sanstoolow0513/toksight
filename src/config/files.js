import path from 'node:path';
import { obj } from './parse.js';

// Credential extractors: they receive the raw file content and may only return
// whitelisted, non-secret fields (mode strings, key NAMES, booleans).
function extractCodexAuth(raw) {
  const parsed = JSON.parse(raw);
  return { authMode: typeof parsed?.auth_mode === 'string' ? parsed.auth_mode : null, hasTokens: Boolean(parsed?.tokens) };
}

function extractKeyNames(raw) {
  return { keyNames: Object.keys(obj(JSON.parse(raw))) };
}

function extractEnvNames(raw) {
  const names = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) names.push(match[1]);
  }
  return { varNames: names };
}

export function fileDefs({ env, home }) {
  const zcodeHome = env.ZCODE_HOME || path.join(home, '.zcode');
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  // CLAUDE_CONFIG_DIR relocates .claude.json too (GitHub-confirmed behavior);
  // by default it lives next to ~/.claude, not inside it.
  const claudeState = env.CLAUDE_CONFIG_DIR ? path.join(claudeDir, '.claude.json') : path.join(home, '.claude.json');
  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  const kimiHome = env.KIMI_CODE_HOME || path.join(home, '.kimi-code');
  const openCodeConfigDir = env.OPENCODE_CONFIG_DIR
    ? path.resolve(env.OPENCODE_CONFIG_DIR)
    : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode');
  const openCodeCustom = env.OPENCODE_CONFIG ? path.resolve(env.OPENCODE_CONFIG) : null;
  const customExt = openCodeCustom ? path.extname(openCodeCustom).toLowerCase() : '';
  // Data root matches src/clients/opencode.js (OPENCODE_PATH is toksight's own
  // injection convention) so the config page and the stats pipeline always
  // agree on where opencode's data lives.
  const openCodeDataRoot =
    env.OPENCODE_PATH || path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode');
  const openCodeStateRoot = path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'opencode');

  return [
    {
      id: 'zcode.providers', agentId: 'zcode', label: 'Providers and models', fileName: 'config.json',
      format: 'json', kind: 'config', path: path.join(zcodeHome, 'v2', 'config.json'),
    },
    {
      id: 'zcode.settings', agentId: 'zcode', label: 'Application settings', fileName: 'setting.json',
      format: 'json', kind: 'config', path: path.join(zcodeHome, 'v2', 'setting.json'),
    },
    {
      id: 'zcode.plugins', agentId: 'zcode', label: 'CLI plugin settings', fileName: 'config.json',
      format: 'json', kind: 'config', path: path.join(zcodeHome, 'cli', 'config.json'),
    },
    {
      id: 'zcode.credentials', agentId: 'zcode', label: 'Stored credentials', fileName: 'credentials.json',
      format: 'json', kind: 'secret', path: path.join(zcodeHome, 'v2', 'credentials.json'), extract: extractKeyNames,
    },
    {
      id: 'claude.settings', agentId: 'claude', label: 'User settings', fileName: 'settings.json',
      format: 'json', kind: 'config', path: path.join(claudeDir, 'settings.json'),
    },
    {
      id: 'claude.state', agentId: 'claude', label: 'Application state', fileName: '.claude.json',
      format: 'json', kind: 'config', path: claudeState,
    },
    {
      id: 'claude.credentials', agentId: 'claude', label: 'Stored credentials', fileName: '.credentials.json',
      format: 'json', kind: 'secret', path: path.join(claudeDir, '.credentials.json'),
      extract: () => ({ present: true }),
    },
    {
      id: 'codex.config', agentId: 'codex', label: 'User configuration', fileName: 'config.toml',
      format: 'toml', kind: 'config', path: path.join(codexHome, 'config.toml'),
    },
    {
      id: 'codex.auth', agentId: 'codex', label: 'Auth store', fileName: 'auth.json',
      format: 'json', kind: 'secret', path: path.join(codexHome, 'auth.json'), extract: extractCodexAuth,
    },
    {
      id: 'codex.env', agentId: 'codex', label: 'Environment overrides', fileName: '.env',
      format: 'text', kind: 'secret', path: path.join(codexHome, '.env'), extract: extractEnvNames,
    },
    {
      id: 'opencode.config-json', agentId: 'opencode', label: 'User configuration (JSON)', fileName: 'opencode.json',
      format: 'json', kind: 'config',
      path: customExt === '.json' ? openCodeCustom : path.join(openCodeConfigDir, 'opencode.json'),
    },
    {
      id: 'opencode.config-jsonc', agentId: 'opencode', label: 'User configuration (JSONC)', fileName: 'opencode.jsonc',
      format: 'jsonc', kind: 'config',
      path: customExt === '.jsonc' ? openCodeCustom : path.join(openCodeConfigDir, 'opencode.jsonc'),
    },
    {
      id: 'opencode.auth', agentId: 'opencode', label: 'Auth store', fileName: 'auth.json',
      format: 'json', kind: 'secret', path: path.join(openCodeDataRoot, 'auth.json'), extract: extractKeyNames,
    },
    {
      id: 'opencode.state-model', agentId: 'opencode', label: 'Recent models', fileName: 'model.json',
      format: 'json', kind: 'config', path: path.join(openCodeStateRoot, 'model.json'),
    },
    {
      id: 'kimi.config', agentId: 'kimi', label: 'Runtime configuration', fileName: 'config.toml',
      format: 'toml', kind: 'config', path: path.join(kimiHome, 'config.toml'),
    },
    {
      id: 'kimi.tui', agentId: 'kimi', label: 'Terminal UI settings', fileName: 'tui.toml',
      format: 'toml', kind: 'config', path: path.join(kimiHome, 'tui.toml'),
    },
    {
      id: 'kimi.mcp', agentId: 'kimi', label: 'MCP servers', fileName: 'mcp.json',
      format: 'json', kind: 'config', path: path.join(kimiHome, 'mcp.json'),
    },
    {
      id: 'kimi.region', agentId: 'kimi', label: 'Service region', fileName: 'region',
      format: 'text', kind: 'config', path: path.join(kimiHome, 'region'),
    },
    {
      id: 'kimi.credentials', agentId: 'kimi', label: 'Stored credentials', fileName: 'kimi-code.json',
      format: 'json', kind: 'secret', path: path.join(kimiHome, 'credentials', 'kimi-code.json'),
      extract: () => ({ present: true }),
    },
  ];
}

