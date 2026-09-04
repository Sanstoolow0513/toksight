// Read-only agent configuration viewer for the web dashboard.
//
// A fixed allowlist of user-level configuration files for the five supported
// agents is read to build (a) a small semantic summary per agent — default
// model, providers, auth method, notable settings — and (b) a redacted
// raw-text preview. Credential files are probed only for existence and a few
// whitelisted fields (auth mode, key names) and are never previewed. Nothing
// is written anywhere; project-level and managed/enterprise policy files stay
// out of scope on purpose.

import os from 'node:os';
import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';

import { parseToml } from './toml.js';

export const PREVIEW_BYTES = 64 * 1024;
export const MAX_READ_BYTES = 1024 * 1024;
export const MAX_MODELS = 60;
const REDACTED = '[REDACTED]';

const AGENTS = [
  { id: 'zcode', label: 'ZCode' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'kimi', label: 'Kimi Code' },
];

// Key names whose VALUES must never be displayed. Unanchored on purpose:
// over-redacting a flag like `apiKeyRequired` is harmless, leaking a key is
// not. Booleans and numbers under these keys are still shown (a flag is not a
// secret); only strings and containers are redacted.
const SENSITIVE_KEY = /(?:^key$|^token$|^access$|^refresh$|api[_-]?key|access[_-]?token|refresh[_-]?token|(?:id|session)[_-]?token|auth(?:orization)?|oauth|bearer|secret|password|passwd|credential|cookie|private[_-]?key|client[_-]?secret|user[_-]?id|machine[_-]?id)/i;

// Containers whose whole content is sensitive regardless of inner key names
// (HTTP headers, oauth blocks, credential stores). `env` is deliberately NOT
// here: env var names describe their own sensitivity (ANTHROPIC_API_KEY vs
// ANTHROPIC_MODEL), so env is walked into and redacted per key — that is what
// keeps Claude's third-party endpoint/model settings readable.
const SENSITIVE_CONTAINER = /^(?:headers?|custom[_-]?headers?|oauth|credentials?|secrets?)$/i;

// ---------------------------------------------------------------------------
// Redaction

function redactString(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|xox[baprs]|gh[pousr])[-_][A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/(https?:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`)
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s]+/gi, `$1${REDACTED}`);
}

function redactedTree(value) {
  if (Array.isArray(value)) return value.map((entry) => redactedTree(entry));
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_CONTAINER.test(key)) {
      out[key] = REDACTED;
    } else if (SENSITIVE_KEY.test(key) && (typeof entry === 'string' || (entry && typeof entry === 'object'))) {
      out[key] = REDACTED;
    } else {
      out[key] = redactedTree(entry);
    }
  }
  return out;
}

// Scan one line of a value: count brackets that sit outside quoted spans
// and comments, and report the multi-line string delimiter (`"""`/`'''`)
// the line ends inside, if any. `triple` is the delimiter the line starts
// inside (null when it does not). Single-quote state never crosses a line —
// an unterminated one-line string means a malformed file, and the next line
// is a fresh statement.
function scanValueLine(line, triple) {
  let depth = 0;
  let quote = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (triple) {
      if (ch === '\\') { i += 2; continue; }
      if (line.startsWith(triple, i)) { triple = null; i += 3; continue; }
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const delim = ch.repeat(3);
      if (line.startsWith(delim, i)) { triple = delim; i += 3; continue; }
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '#') break; // TOML comment
    if (ch === '/' && line[i + 1] === '/') break; // JSONC comment
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    i += 1;
  }
  return { depth, triple };
}

function redactLines(content) {
  let sensitiveSection = false;
  // Active while a sensitive value spans lines. `triple` is the open
  // multi-line string delimiter — every content line is dropped whole,
  // because it is pure secret. `depth` is the count of still-open brackets
  // — lines are redacted in place until they close, quote-aware so a `]`
  // inside a string does not end the value early. A value that never closes
  // (a preview cut at PREVIEW_BYTES, or a malformed file) suppresses to the
  // end of the preview.
  let suppress = null;

  return content
    .split(/\r?\n/)
    .flatMap((line) => {
      if (suppress) {
        const startedInString = Boolean(suppress.triple);
        const scan = scanValueLine(line, suppress.triple);
        suppress.triple = scan.triple;
        suppress.depth += scan.depth;
        if (startedInString) {
          // String content, or the closing line (which may trail more
          // secret) — drop it whole.
          if (!scan.triple && suppress.depth <= 0) suppress = null;
          return [];
        }
        if (!scan.triple && suppress.depth <= 0) suppress = null;
        const assignment = line.replace(/^\s*(["']?[^"'=:\s]+["']?\s*[:=]\s*).*(,?)\s*$/, `$1"${REDACTED}"$2`);
        if (assignment !== line) return [assignment];
        if (/^\s*[}\]]\s*,?\s*$/.test(line) || /^\s*(?:\/\/|#|$)/.test(line)) return [line];
        return [`${line.match(/^\s*/)?.[0] || ''}"${REDACTED}"${line.trimEnd().endsWith(',') ? ',' : ''}`];
      }

      const section = line.match(/^\s*\[+([^\]]+)]+/);
      if (section) {
        sensitiveSection = section[1]
          .split('.')
          .some((part) => SENSITIVE_KEY.test(part) || SENSITIVE_CONTAINER.test(part.replace(/^['"]|['"]$/g, '')));
        return [line];
      }

      // The optional leading `{`/`[` lets a first JSON key on the same line
      // as its opening brace (`{"apiKey": …` in a malformed file) be seen.
      const keyMatch = line.match(/^\s*[{\[]?\s*["']?([^"'=:\s]+)["']?\s*[:=]/);
      const key = keyMatch?.[1] || '';

      if (keyMatch && (sensitiveSection || SENSITIVE_KEY.test(key) || SENSITIVE_CONTAINER.test(key))) {
        // A value that stays open past this line (a multi-line string, or
        // brackets that do not close) must suppress its continuation lines;
        // a balanced value is rewritten in place either way.
        const scan = scanValueLine(line.slice(keyMatch[0].length), null);
        if (scan.triple || scan.depth > 0) {
          suppress = { depth: scan.depth, triple: scan.triple };
        }
        return [line.replace(/([:=]\s*).*(,?)\s*$/, `$1"${REDACTED}"$2`)];
      }

      if (!keyMatch && sensitiveSection) {
        // A bare line inside a sensitive section: closers, comments and
        // blanks pass; anything else is value content of a malformed
        // statement and is redacted.
        if (/^\s*[}\]]\s*,?\s*$/.test(line) || /^\s*(?:\/\/|#|$)/.test(line)) return [line];
        return [`${line.match(/^\s*/)?.[0] || ''}"${REDACTED}"${line.trimEnd().endsWith(',') ? ',' : ''}`];
      }

      // Catch common bearer/key literals even when a format uses an unusual
      // key shape. Previews are for orientation; this errs on the safe side.
      return [redactString(line)];
    })
    .join('\n');
}

export function redactConfig(content, format = 'text') {
  if (format === 'json' || format === 'jsonc') {
    try {
      return JSON.stringify(redactedTree(JSON.parse(format === 'jsonc' ? stripJsonc(content) : content)), null, 2);
    } catch {
      // A malformed or mid-write file still gets a safe line-based preview.
    }
  }
  return redactLines(content);
}

// ---------------------------------------------------------------------------
// Parsing helpers

// Strips // and /* */ comments (string-aware) and trailing commas so a JSONC
// config can go through JSON.parse.
function stripJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') {
          out += text[i] + (text[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// ---------------------------------------------------------------------------
// File inventory

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

// ---------------------------------------------------------------------------
// Per-file inspection

function missingFile(def) {
  return {
    file: {
      id: def.id, agentId: def.agentId, label: def.label, fileName: def.fileName,
      format: def.format, kind: def.kind, path: def.path, exists: false, size: 0, modifiedAt: null,
      previewable: def.kind !== 'secret', preview: null, truncated: false, error: null,
    },
    data: { exists: false },
  };
}

async function inspectOne(def, warnings) {
  let info;
  try {
    info = await stat(def.path);
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return missingFile(def);
    warnings.push(`${def.agentId}: cannot inspect ${def.path} (${err?.message || err})`);
    const base = missingFile(def);
    return { file: { ...base.file, exists: true, error: String(err?.message || err), previewable: false }, data: base.data };
  }
  if (!info.isFile()) {
    warnings.push(`${def.agentId}: ${def.path} is not a regular file`);
    const base = missingFile(def);
    return { file: { ...base.file, exists: true, error: 'not a regular file', previewable: false }, data: base.data };
  }

  const file = {
    id: def.id, agentId: def.agentId, label: def.label, fileName: def.fileName,
    format: def.format, kind: def.kind, path: def.path, exists: true, size: info.size,
    modifiedAt: info.mtime.toISOString(), truncated: info.size > PREVIEW_BYTES, error: null,
  };
  const data = { exists: true };

  if (info.size > MAX_READ_BYTES) {
    warnings.push(`${def.agentId}: ${def.path} is larger than 1 MB; only metadata is shown`);
    file.previewable = def.kind !== 'secret';
    file.preview = null;
    return { file, data };
  }

  let raw;
  try {
    raw = await readFile(def.path, 'utf8');
  } catch (err) {
    warnings.push(`${def.agentId}: cannot read ${def.path} (${err?.message || err})`);
    file.error = String(err?.message || err);
    file.previewable = false;
    return { file, data };
  }

  if (def.kind === 'secret') {
    file.previewable = false;
    file.preview = null;
    if (def.extract) {
      try {
        data.extract = def.extract(raw);
      } catch (err) {
        warnings.push(`${def.agentId}: cannot parse ${def.path} (${err?.message || err})`);
      }
    }
    return { file, data };
  }

  file.previewable = true;
  file.preview = redactConfig(info.size > PREVIEW_BYTES ? raw.slice(0, PREVIEW_BYTES) : raw, def.format);

  if (def.format === 'json' || def.format === 'jsonc') {
    try {
      data.parsed = JSON.parse(def.format === 'jsonc' ? stripJsonc(raw) : raw);
    } catch {
      warnings.push(`${def.agentId}: cannot parse ${def.path}`);
    }
  } else if (def.format === 'toml') {
    const { value, error } = parseToml(raw);
    data.parsed = value;
    if (error) warnings.push(`${def.agentId}: ${def.path}: ${error}`);
  } else {
    data.raw = raw;
  }
  return { file, data };
}

// ---------------------------------------------------------------------------
// Summaries

function joinList(values, cap = 6) {
  const list = values.slice(0, cap).map(String);
  const rest = values.length - list.length;
  return rest > 0 ? `${list.join(', ')} (+${rest})` : list.join(', ');
}

function providerRow(name, row) {
  const options = obj(row?.options);
  return {
    name: String(name),
    kind: row?.kind || row?.type ? String(row.kind ?? row.type) : null,
    baseURL: typeof options.baseURL === 'string' ? options.baseURL : typeof row?.base_url === 'string' ? row.base_url : null,
    apiKeySet: Boolean(options.apiKey || row?.api_key),
    authVia: row?.oauth || row?.oauth_storage ? 'oauth' : options.apiKey || row?.api_key ? 'key' : null,
    enabled: row?.enabled == null ? null : Boolean(row.enabled),
    modelCount: row?.models && typeof row.models === 'object' ? Object.keys(row.models).length : null,
  };
}

async function summarizeClaude({ data }) {
  const settings = obj(data.get('claude.settings')?.parsed);
  const state = obj(data.get('claude.state')?.parsed);
  const creds = data.get('claude.credentials');
  const env = obj(settings.env);
  const facts = [];

  // Non-sensitive env entries are the meat of a third-party-endpoint setup —
  // show each one (ANTHROPIC_MODEL, ANTHROPIC_BASE_URL, ...). Sensitive names
  // were already filtered by the preview redactor; here they are skipped so
  // they never reach the summary either.
  for (const [name, value] of Object.entries(env)) {
    if (!SENSITIVE_KEY.test(name) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      facts.push({ key: name, value: String(value) });
    }
  }
  if (settings.model) facts.push({ key: 'model', value: String(settings.model) });
  if (settings.theme) facts.push({ key: 'factTheme', value: String(settings.theme) });
  if (settings.autoUpdatesChannel) facts.push({ key: 'factAutoUpdate', value: String(settings.autoUpdatesChannel) });
  if (state.installMethod) facts.push({ key: 'factInstallMethod', value: String(state.installMethod) });
  if (state.autoUpdates != null) facts.push({ key: 'factAutoUpdates', value: String(state.autoUpdates) });

  const apiKeyEnv = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
  const auth = creds?.exists
    ? { method: 'oauth', detail: '.claude/.credentials.json' }
    : apiKeyEnv
      ? { method: 'envKey', detail: env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN' }
      : state.oauthAccount
        ? { method: 'oauth', detail: '.claude.json' }
        : null;

  return {
    defaultModel: settings.model || env.ANTHROPIC_MODEL || null,
    auth,
    facts,
    providers: [],
    models: [],
    mcpServers: Object.keys(obj(state.mcpServers)),
  };
}

async function summarizeCodex({ data, env, home }) {
  const cfg = obj(data.get('codex.config')?.parsed);
  const authExtract = data.get('codex.auth')?.extract || null;
  const varNames = data.get('codex.env')?.extract?.varNames || [];

  let profiles = [];
  try {
    profiles = (await readdir(env.CODEX_HOME || path.join(home, '.codex')))
      .filter((name) => /\.config\.toml$/.test(name))
      .map((name) => name.replace(/\.config\.toml$/, ''));
  } catch {
    // No codex home is normal — nothing was configured yet.
  }

  const facts = [];
  if (cfg.approval_policy) facts.push({ key: 'factApproval', value: String(cfg.approval_policy) });
  if (cfg.sandbox_mode) facts.push({ key: 'factSandbox', value: String(cfg.sandbox_mode) });
  if (obj(cfg.windows).sandbox) facts.push({ key: 'factWindowsSandbox', value: String(cfg.windows.sandbox) });
  if (cfg.model_provider) facts.push({ key: 'factActiveProvider', value: String(cfg.model_provider) });
  const trusted = Object.entries(obj(cfg.projects))
    .filter(([, value]) => obj(value).trust_level === 'trusted')
    .map(([projectPath]) => projectPath);
  if (trusted.length) facts.push({ key: 'factTrustedProjects', value: joinList(trusted, 4) });
  if (profiles.length) facts.push({ key: 'factProfiles', value: joinList(profiles) });
  if (varNames.length) facts.push({ key: 'factEnvFile', value: joinList(varNames) });

  const authMode = authExtract?.authMode;
  const auth = authMode === 'chatgpt'
    ? { method: 'chatgpt' }
    : authMode === 'apikey'
      ? { method: 'apikey', detail: 'auth.json' }
      : data.get('codex.auth')?.exists
        ? { method: 'file', detail: 'auth.json' }
        : null;

  return {
    defaultModel: cfg.model ? (cfg.model_reasoning_effort ? `${cfg.model} · ${cfg.model_reasoning_effort}` : String(cfg.model)) : null,
    auth,
    facts,
    providers: Object.entries(obj(cfg.model_providers)).map(([name, row]) => ({
      ...providerRow(name, row),
      kind: row?.wire_api ? String(row.wire_api) : row?.name ? String(row.name) : null,
      authVia: row?.api_key ? 'key' : row?.env_key ? 'env' : null,
    })),
    models: [],
    mcpServers: Object.keys(obj(cfg.mcp_servers)),
  };
}

async function summarizeOpenCode({ data }) {
  const cfg = obj(data.get('opencode.config-json')?.parsed || data.get('opencode.config-jsonc')?.parsed);
  const authKeyNames = data.get('opencode.auth')?.extract?.keyNames || [];
  const recent = Array.isArray(data.get('opencode.state-model')?.parsed?.recent)
    ? data.get('opencode.state-model').parsed.recent
    : [];

  const facts = [];
  if (cfg.autoupdate != null) facts.push({ key: 'factAutoUpdate', value: String(cfg.autoupdate) });
  if (cfg.share != null) facts.push({ key: 'factShare', value: String(cfg.share) });
  const disabled = Array.isArray(cfg.disabled_providers) ? cfg.disabled_providers : [];
  if (disabled.length) facts.push({ key: 'factDisabledProviders', value: joinList(disabled) });
  const recentIds = recent
    .filter((row) => row && typeof row === 'object')
    .map((row) => `${row.providerID}/${row.modelID}`)
    .filter((value) => !value.includes('undefined'));
  if (recentIds.length) facts.push({ key: 'factRecentModels', value: joinList(recentIds, 4) });

  return {
    defaultModel: cfg.model || recentIds[0] || null,
    auth: authKeyNames.length ? { method: 'providers', detail: joinList(authKeyNames, 4) } : null,
    facts,
    providers: Object.entries(obj(cfg.provider)).map(([name, row]) => providerRow(name, row)),
    models: [],
    mcpServers: Object.keys(obj(cfg.mcp)),
  };
}

async function summarizeKimi({ data }) {
  const cfg = obj(data.get('kimi.config')?.parsed);
  const tui = obj(data.get('kimi.tui')?.parsed);
  const mcp = obj(data.get('kimi.mcp')?.parsed);
  const region = typeof data.get('kimi.region')?.raw === 'string' ? data.get('kimi.region').raw.trim() : null;

  const facts = [];
  if (cfg.default_permission_mode) facts.push({ key: 'factPermissionMode', value: String(cfg.default_permission_mode) });
  if (obj(cfg.thinking).enabled) {
    facts.push({ key: 'factThinking', value: cfg.thinking.effort ? String(cfg.thinking.effort) : 'on' });
  }
  if (region) facts.push({ key: 'factRegion', value: region });
  if (tui.theme) facts.push({ key: 'factTheme', value: String(tui.theme) });
  if (obj(tui.notifications).enabled != null) {
    facts.push({ key: 'factNotifications', value: String(tui.notifications.enabled) });
  }
  if (obj(tui.upgrade).auto_install != null) facts.push({ key: 'factAutoInstall', value: String(tui.upgrade.auto_install) });

  const providers = Object.entries(obj(cfg.providers)).map(([name, row]) => ({
    ...providerRow(name, row),
    kind: row?.type ? String(row.type) : null,
    authVia: row?.oauth ? 'oauth' : row?.api_key ? 'key' : null,
  }));

  const models = Object.entries(obj(cfg.models)).map(([name, row]) => ({
    name: String(name),
    provider: row?.provider ? String(row.provider) : null,
    contextTokens: Number.isFinite(row?.max_context_size) ? row.max_context_size : null,
  }));

  return {
    defaultModel: cfg.default_model ? String(cfg.default_model) : null,
    auth: data.get('kimi.credentials')?.exists ? { method: 'oauth', detail: 'credentials/kimi-code.json' } : null,
    facts,
    providers,
    models,
    mcpServers: Object.keys(obj(mcp.mcpServers)),
  };
}

async function summarizeZcode({ data }) {
  const v2 = obj(data.get('zcode.providers')?.parsed);
  const setting = obj(data.get('zcode.settings')?.parsed);
  const cli = obj(data.get('zcode.plugins')?.parsed);
  const credKeyNames = data.get('zcode.credentials')?.extract?.keyNames || [];

  const facts = [];
  if (setting.locale) facts.push({ key: 'factLocale', value: String(setting.locale) });
  if (setting.memoryEnabled != null) facts.push({ key: 'factMemory', value: String(setting.memoryEnabled) });
  if (setting.autoDownloadAndInstallUpdates != null) {
    facts.push({ key: 'factAutoInstall', value: String(setting.autoDownloadAndInstallUpdates) });
  }
  if (setting.messageStreamShowReasoning != null) {
    facts.push({ key: 'factShowReasoning', value: String(setting.messageStreamShowReasoning) });
  }
  const enabledPlugins = Object.entries(obj(obj(cli.plugins).enabledPlugins))
    .filter(([, value]) => value)
    .map(([name]) => name);
  if (enabledPlugins.length) facts.push({ key: 'factPlugins', value: joinList(enabledPlugins, 6) });
  const suppressed = Array.isArray(obj(cli.plugins).suppressedBuiltins) ? cli.plugins.suppressedBuiltins : [];
  if (suppressed.length) facts.push({ key: 'factSuppressedPlugins', value: String(suppressed.length) });

  const providers = Object.entries(obj(v2.provider)).map(([name, row]) => ({
    ...providerRow(name, row),
    kind: row?.kind ? String(row.kind) : null,
  }));

  const models = [];
  for (const [providerName, row] of Object.entries(obj(v2.provider))) {
    for (const [modelName, modelRow] of Object.entries(obj(row?.models))) {
      models.push({
        name: String(modelName),
        provider: String(providerName),
        contextTokens: Number.isFinite(obj(modelRow?.limit).context) ? modelRow.limit.context : null,
      });
    }
  }

  return {
    defaultModel: null,
    auth: credKeyNames.some((key) => /access_token|jwttoken|refresh/i.test(key))
      ? { method: 'oauth', detail: 'z.ai' }
      : credKeyNames.length
        ? { method: 'file', detail: 'v2/credentials.json' }
        : null,
    facts,
    providers,
    models,
    mcpServers: [],
  };
}

const SUMMARIZERS = {
  zcode: summarizeZcode,
  claude: summarizeClaude,
  codex: summarizeCodex,
  opencode: summarizeOpenCode,
  kimi: summarizeKimi,
};

function normalizeSummary(summary) {
  const raw = summary || {};
  const facts = (Array.isArray(raw.facts) ? raw.facts : [])
    .filter((fact) => fact && fact.key && fact.value != null && fact.value !== '')
    .slice(0, 40)
    .map((fact) => ({ key: String(fact.key), value: redactString(String(fact.value)) }));
  return {
    defaultModel: raw.defaultModel ? redactString(String(raw.defaultModel)) : null,
    auth: raw.auth && raw.auth.method
      ? { method: String(raw.auth.method), detail: raw.auth.detail ? redactString(String(raw.auth.detail)) : null }
      : null,
    facts,
    providers: (Array.isArray(raw.providers) ? raw.providers : []).map((row) => ({
      name: String(row?.name ?? ''),
      kind: row?.kind ? String(row.kind) : null,
      baseURL: row?.baseURL ? redactString(String(row.baseURL)) : null,
      apiKeySet: Boolean(row?.apiKeySet),
      authVia: row?.authVia ? String(row.authVia) : null,
      enabled: row?.enabled == null ? null : Boolean(row.enabled),
      modelCount: Number.isFinite(row?.modelCount) ? row.modelCount : null,
    })),
    models: (Array.isArray(raw.models) ? raw.models : []).slice(0, MAX_MODELS).map((row) => ({
      name: String(row?.name ?? ''),
      provider: row?.provider ? String(row.provider) : null,
      contextTokens: Number.isFinite(row?.contextTokens) ? row.contextTokens : null,
    })),
    mcpServers: (Array.isArray(raw.mcpServers) ? raw.mcpServers : []).map(String).slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// Service

export function createAgentConfigService({ env = process.env, home = os.homedir() } = {}) {
  const ctx = { env, home };
  const defs = fileDefs(ctx);

  return {
    async inspect() {
      const warnings = [];
      const agents = [];
      for (const agent of AGENTS) {
        const files = [];
        const data = new Map();
        for (const def of defs.filter((entry) => entry.agentId === agent.id)) {
          try {
            const { file, data: fileData } = await inspectOne(def, warnings);
            files.push(file);
            data.set(def.id, fileData);
          } catch (err) {
            warnings.push(`${agent.id}: cannot inspect ${def.path} (${err?.message || err})`);
            files.push({ ...missingFile(def).file, exists: true, error: String(err?.message || err), previewable: false });
          }
        }

        let summary = { defaultModel: null, auth: null, facts: [], providers: [], models: [], mcpServers: [] };
        try {
          summary = normalizeSummary(await SUMMARIZERS[agent.id]({ data, env, home }));
        } catch (err) {
          warnings.push(`${agent.id}: cannot summarize configuration (${err?.message || err})`);
        }
        agents.push({ id: agent.id, label: agent.label, files, summary });
      }
      return { agents, warnings };
    },
  };
}
