// Safe, fixed-scope configuration transfer for the web dashboard.
//
// Only the user-level configuration files listed below are ever inspected or
// written. Session data, credentials/auth stores, project configuration and
// managed/enterprise policy files are deliberately out of scope.

import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';

export const CONFIG_BUNDLE_FORMAT = 'toksight-agent-config';
export const CONFIG_BUNDLE_VERSION = 1;
export const MAX_CONFIG_BYTES = 1024 * 1024;
export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
const PREVIEW_BYTES = 64 * 1024;
const REDACTED = '[REDACTED]';

const AGENTS = [
  { id: 'zcode', label: 'ZCode' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'kimi', label: 'Kimi Code' },
];

const SENSITIVE_KEY = /(?:^key$|^token$|api[_-]?key|access[_-]?token|refresh[_-]?token|(?:id|session)[_-]?token|auth(?:orization)?|bearer|secret|password|passwd|credential|cookie|private[_-]?key|client[_-]?secret)/i;
const SENSITIVE_CONTAINER = /^(?:env|environment|headers?|custom[_-]?headers?|oauth|credentials?)$/i;

export class AgentConfigError extends Error {
  constructor(message, { code = 'INVALID_CONFIG', status = 400 } = {}) {
    super(message);
    this.name = 'AgentConfigError';
    this.code = code;
    this.status = status;
  }
}

function configItems({ env, home }) {
  const zcodeHome = env.ZCODE_HOME || path.join(home, '.zcode');
  const claudeHome = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  const kimiHome = env.KIMI_CODE_HOME || path.join(home, '.kimi-code');
  const openCodeHome = env.OPENCODE_CONFIG_DIR
    ? path.resolve(env.OPENCODE_CONFIG_DIR)
    : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode');
  const customOpenCode = env.OPENCODE_CONFIG ? path.resolve(env.OPENCODE_CONFIG) : null;
  const customOpenCodeExt = customOpenCode ? path.extname(customOpenCode).toLowerCase() : '';
  const customIsJson = customOpenCodeExt === '.json';
  const customIsJsonc = customOpenCodeExt === '.jsonc';

  return [
    {
      id: 'zcode.providers',
      agentId: 'zcode',
      label: 'Providers and models',
      fileName: 'config.json',
      format: 'json',
      path: path.join(zcodeHome, 'v2', 'config.json'),
    },
    {
      id: 'zcode.settings',
      agentId: 'zcode',
      label: 'Application settings',
      fileName: 'setting.json',
      format: 'json',
      path: path.join(zcodeHome, 'v2', 'setting.json'),
    },
    {
      id: 'zcode.plugins',
      agentId: 'zcode',
      label: 'CLI plugin settings',
      fileName: 'config.json',
      format: 'json',
      path: path.join(zcodeHome, 'cli', 'config.json'),
    },
    {
      id: 'claude.settings',
      agentId: 'claude',
      label: 'User settings',
      fileName: 'settings.json',
      format: 'json',
      path: path.join(claudeHome, 'settings.json'),
    },
    {
      id: 'codex.config',
      agentId: 'codex',
      label: 'User configuration',
      fileName: 'config.toml',
      format: 'toml',
      path: path.join(codexHome, 'config.toml'),
    },
    {
      id: 'opencode.config-json',
      agentId: 'opencode',
      label: 'User configuration (JSON)',
      fileName: path.basename(customIsJson ? customOpenCode : 'opencode.json'),
      format: 'json',
      path: customIsJson ? customOpenCode : path.join(openCodeHome, 'opencode.json'),
    },
    {
      id: 'opencode.config-jsonc',
      agentId: 'opencode',
      label: 'User configuration (JSONC)',
      fileName: path.basename(customIsJsonc ? customOpenCode : 'opencode.jsonc'),
      format: 'jsonc',
      path: customIsJsonc ? customOpenCode : path.join(openCodeHome, 'opencode.jsonc'),
    },
    {
      id: 'kimi.config',
      agentId: 'kimi',
      label: 'Runtime configuration',
      fileName: 'config.toml',
      format: 'toml',
      path: path.join(kimiHome, 'config.toml'),
    },
    {
      id: 'kimi.tui',
      agentId: 'kimi',
      label: 'Terminal UI settings',
      fileName: 'tui.toml',
      format: 'toml',
      path: path.join(kimiHome, 'tui.toml'),
    },
    {
      id: 'kimi.mcp',
      agentId: 'kimi',
      label: 'MCP servers',
      fileName: 'mcp.json',
      format: 'json',
      path: path.join(kimiHome, 'mcp.json'),
    },
  ];
}

function itemMap(ctx) {
  return new Map(configItems(ctx).map((item) => [item.id, item]));
}

function digest(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function byteLength(content) {
  return Buffer.byteLength(content, 'utf8');
}

function redactString(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|xox[baprs]|gh[pousr])[-_][A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/(https?:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`)
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s]+/gi, `$1${REDACTED}`);
}

function redactedTree(value, force = false) {
  if (force) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redactedTree(entry));
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) || SENSITIVE_CONTAINER.test(key) ? REDACTED : redactedTree(entry);
  }
  return out;
}

function redactLines(content) {
  let sensitiveSection = false;
  let jsonSensitiveDepth = 0;

  return content
    .split(/\r?\n/)
    .map((line) => {
      const section = line.match(/^\s*\[([^\]]+)]/);
      if (section) {
        sensitiveSection = section[1]
          .split('.')
          .some((part) => SENSITIVE_KEY.test(part) || SENSITIVE_CONTAINER.test(part.replace(/^['"]|['"]$/g, '')));
        return line;
      }

      const jsonKey = line.match(/^\s*["']?([^"'=:\s]+)["']?\s*[:=]/);
      const key = jsonKey?.[1] || '';
      const startsSensitiveObject =
        SENSITIVE_CONTAINER.test(key) && /[:=]\s*[\[{]/.test(line);

      if (startsSensitiveObject) {
        const opens = (line.match(/[\[{]/g) || []).length;
        const closes = (line.match(/[\]}]/g) || []).length;
        jsonSensitiveDepth = Math.max(0, opens - closes);
        return line.replace(/([:=]\s*)[\[{].*$/, `$1"${REDACTED}"${line.trimEnd().endsWith(',') ? ',' : ''}`);
      }

      if (jsonSensitiveDepth > 0) {
        jsonSensitiveDepth += (line.match(/[\[{]/g) || []).length - (line.match(/[\]}]/g) || []).length;
        const assignment = line.replace(/^\s*(["']?[^"'=:\s]+["']?\s*[:=]\s*).*(,?)\s*$/, `$1"${REDACTED}"$2`);
        if (assignment !== line) return assignment;
        if (/^\s*[}\]]\s*,?\s*$/.test(line) || /^\s*(?:\/\/|#|$)/.test(line)) return line;
        return `${line.match(/^\s*/)?.[0] || ''}"${REDACTED}"${line.trimEnd().endsWith(',') ? ',' : ''}`;
      }

      if (sensitiveSection || SENSITIVE_KEY.test(key)) {
        return line.replace(/([:=]\s*).*(,?)\s*$/, `$1"${REDACTED}"$2`);
      }

      // Catch common bearer/key literals even when a format uses an unusual
      // key shape. This is intentionally conservative: previews are for
      // orientation, while exports always contain the exact original text.
      return redactString(line);
    })
    .join('\n');
}

export function redactConfig(content, format = 'text') {
  if (format === 'json') {
    try {
      return JSON.stringify(redactedTree(JSON.parse(content)), null, 2);
    } catch {
      // A malformed/in-progress JSON file can still be previewed safely using
      // the conservative line redactor below.
    }
  }
  return redactLines(content);
}

function compactTimestamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function inspectOne(item) {
  let info;
  try {
    info = await stat(item.path);
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
      return { ...publicItem(item), exists: false, exportable: false, size: 0, modifiedAt: null, preview: null, truncated: false, redacted: true };
    }
    throw err;
  }

  if (!info.isFile()) {
    throw new AgentConfigError(`${item.path} is not a regular file`, { code: 'CONFIG_NOT_FILE' });
  }

  const handle = await open(item.path, 'r');
  let content;
  try {
    const buffer = Buffer.alloc(Math.min(PREVIEW_BYTES, info.size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    content = buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
  const truncated = info.size > PREVIEW_BYTES;
  return {
    ...publicItem(item),
    exists: true,
    exportable: info.size <= MAX_CONFIG_BYTES,
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    preview: redactConfig(content, item.format),
    truncated,
    redacted: true,
  };
}

function publicItem(item) {
  return {
    id: item.id,
    agentId: item.agentId,
    label: item.label,
    fileName: item.fileName,
    format: item.format,
    path: item.path,
  };
}

function requestedItems(ids, items, { requireSelection = true } = {}) {
  if (!Array.isArray(ids) || (requireSelection && ids.length === 0)) {
    throw new AgentConfigError('items must be a non-empty array', { code: 'INVALID_SELECTION' });
  }
  const selected = [];
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) {
      throw new AgentConfigError('items must contain unique configuration IDs', { code: 'INVALID_SELECTION' });
    }
    const item = items.get(id);
    if (!item) {
      throw new AgentConfigError(`unsupported configuration item: ${id}`, { code: 'UNSUPPORTED_CONFIG' });
    }
    seen.add(id);
    selected.push(item);
  }
  return selected;
}

function validateBundle(bundle, items) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new AgentConfigError('configuration bundle must be a JSON object', { code: 'INVALID_BUNDLE' });
  }
  if (bundle.format !== CONFIG_BUNDLE_FORMAT || bundle.version !== CONFIG_BUNDLE_VERSION) {
    throw new AgentConfigError('unsupported toksight configuration bundle format or version', { code: 'INVALID_BUNDLE' });
  }
  if (!Array.isArray(bundle.items) || bundle.items.length === 0) {
    throw new AgentConfigError('configuration bundle contains no items', { code: 'INVALID_BUNDLE' });
  }

  const parsed = [];
  const seen = new Set();
  let total = 0;
  for (const packed of bundle.items) {
    if (!packed || typeof packed !== 'object' || typeof packed.id !== 'string' || typeof packed.content !== 'string') {
      throw new AgentConfigError('configuration bundle contains a malformed item', { code: 'INVALID_BUNDLE' });
    }
    const item = items.get(packed.id);
    if (!item) {
      throw new AgentConfigError(`unsupported configuration item: ${packed.id}`, { code: 'UNSUPPORTED_CONFIG' });
    }
    if (seen.has(packed.id)) {
      throw new AgentConfigError(`duplicate configuration item: ${packed.id}`, { code: 'INVALID_BUNDLE' });
    }
    const size = byteLength(packed.content);
    total += size;
    if (size > MAX_CONFIG_BYTES || total > MAX_BUNDLE_BYTES || packed.content.includes('\0')) {
      throw new AgentConfigError(`configuration item is too large or contains invalid text: ${packed.id}`, { code: 'INVALID_BUNDLE' });
    }
    if (typeof packed.sha256 !== 'string' || packed.sha256.toLowerCase() !== digest(packed.content)) {
      throw new AgentConfigError(`configuration checksum mismatch: ${packed.id}`, { code: 'CHECKSUM_MISMATCH' });
    }
    seen.add(packed.id);
    parsed.push({ item, packed, size });
  }
  return parsed;
}

async function uniqueBackupPath(filePath, stamp) {
  const base = `${filePath}.backup-${stamp}`;
  for (let index = 1; ; index += 1) {
    const candidate = index === 1 ? base : `${base}-${index}`;
    try {
      await lstat(candidate);
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return candidate;
      throw err;
    }
  }
}

export function createAgentConfigService({ env = process.env, home = os.homedir(), now = () => Date.now() } = {}) {
  const ctx = { env, home };
  const items = itemMap(ctx);

  return {
    async inspect() {
      const warnings = [];
      const inspected = [];
      for (const item of items.values()) {
        try {
          inspected.push(await inspectOne(item));
        } catch (err) {
          warnings.push(`${item.agentId}: cannot inspect ${item.path} (${err?.message || err})`);
          inspected.push({
            ...publicItem(item),
            exists: true,
            exportable: false,
            size: null,
            modifiedAt: null,
            preview: null,
            truncated: false,
            redacted: true,
            error: String(err?.message || err),
          });
        }
      }
      return {
        agents: AGENTS.map((agent) => ({
          ...agent,
          items: inspected.filter((item) => item.agentId === agent.id),
        })),
        warnings,
      };
    },

    async exportBundle(ids) {
      const selected = requestedItems(ids, items);
      const packed = [];
      let total = 0;
      for (const item of selected) {
        let info;
        let content;
        try {
          info = await stat(item.path);
          if (!info.isFile()) throw new Error('not a regular file');
          if (info.size > MAX_CONFIG_BYTES) throw new Error(`larger than ${MAX_CONFIG_BYTES} bytes`);
          const raw = await readFile(item.path);
          if (raw.length > MAX_CONFIG_BYTES) throw new Error(`larger than ${MAX_CONFIG_BYTES} bytes`);
          content = raw.toString('utf8');
          if (!Buffer.from(content, 'utf8').equals(raw)) throw new Error('not valid UTF-8 text');
        } catch (err) {
          if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
            throw new AgentConfigError(`configuration does not exist: ${item.id}`, { code: 'CONFIG_MISSING' });
          }
          throw new AgentConfigError(`cannot export ${item.id}: ${err?.message || err}`, { code: 'CONFIG_UNREADABLE' });
        }
        if (content.includes('\0')) {
          throw new AgentConfigError(`configuration is not a text file: ${item.id}`, { code: 'CONFIG_UNREADABLE' });
        }
        total += byteLength(content);
        if (total > MAX_BUNDLE_BYTES) {
          throw new AgentConfigError(`selected configurations exceed ${MAX_BUNDLE_BYTES} bytes`, { code: 'BUNDLE_TOO_LARGE', status: 413 });
        }
        packed.push({
          id: item.id,
          agentId: item.agentId,
          label: item.label,
          fileName: item.fileName,
          format: item.format,
          content,
          sha256: digest(content),
        });
      }
      return {
        format: CONFIG_BUNDLE_FORMAT,
        version: CONFIG_BUNDLE_VERSION,
        createdAt: new Date(now()).toISOString(),
        platform: process.platform,
        items: packed,
      };
    },

    async previewBundle(bundle) {
      const parsed = validateBundle(bundle, items);
      const result = [];
      for (const { item, packed, size } of parsed) {
        let destinationExists = false;
        let importable = true;
        try {
          const info = await lstat(item.path);
          destinationExists = true;
          importable = info.isFile() || info.isSymbolicLink();
        } catch (err) {
          if (err?.code === 'ENOTDIR') importable = false;
          else if (err?.code !== 'ENOENT') throw err;
        }
        result.push({
          ...publicItem(item),
          size,
          destinationExists,
          importable,
          preview: redactConfig(Buffer.from(packed.content, 'utf8').subarray(0, PREVIEW_BYTES).toString('utf8'), item.format),
          truncated: size > PREVIEW_BYTES,
          redacted: true,
        });
      }
      return {
        format: bundle.format,
        version: bundle.version,
        createdAt: typeof bundle.createdAt === 'string' ? bundle.createdAt : null,
        items: result,
      };
    },

    async importBundle(bundle, ids) {
      const parsed = validateBundle(bundle, items);
      const packedById = new Map(parsed.map((entry) => [entry.item.id, entry]));
      const selected = requestedItems(ids, items);
      for (const item of selected) {
        if (!packedById.has(item.id)) {
          throw new AgentConfigError(`selected item is not in the bundle: ${item.id}`, { code: 'INVALID_SELECTION' });
        }
      }

      const selectedPaths = new Map();
      for (const item of selected) {
        const resolved = path.resolve(item.path);
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        const previous = selectedPaths.get(key);
        if (previous) {
          throw new AgentConfigError(`configuration items resolve to the same destination: ${previous}, ${item.id}`, {
            code: 'DESTINATION_CONFLICT',
          });
        }
        selectedPaths.set(key, item.id);
      }

      // Refuse to displace directories or other special filesystem objects.
      // Regular files and symlinks can be safely renamed into a backup.
      for (const item of selected) {
        try {
          const info = await lstat(item.path);
          if (!info.isFile() && !info.isSymbolicLink()) {
            throw new AgentConfigError(`configuration destination is not a file: ${item.path}`, {
              code: 'CONFIG_NOT_FILE',
            });
          }
        } catch (err) {
          if (err?.code === 'ENOTDIR') {
            throw new AgentConfigError(`configuration parent is not a directory: ${item.path}`, {
              code: 'CONFIG_NOT_FILE',
            });
          }
          if (err?.code !== 'ENOENT') throw err;
        }
      }

      const stamp = compactTimestamp(now());
      const prepared = [];
      const backups = [];
      const installed = [];
      try {
        // Write every temporary file first. No existing configuration is
        // touched until all package content is ready on the same filesystem.
        for (const item of selected) {
          const { packed } = packedById.get(item.id);
          await mkdir(path.dirname(item.path), { recursive: true, mode: 0o700 });
          const tempPath = path.join(path.dirname(item.path), `.${path.basename(item.path)}.toksight-${process.pid}-${randomUUID()}.tmp`);
          await writeFile(tempPath, packed.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
          prepared.push({ item, tempPath });
        }

        for (const entry of prepared) {
          try {
            const info = await lstat(entry.item.path);
            if (!info.isFile() && !info.isSymbolicLink()) {
              throw new AgentConfigError(`configuration destination is not a file: ${entry.item.path}`, {
                code: 'CONFIG_NOT_FILE',
              });
            }
            const backupPath = await uniqueBackupPath(entry.item.path, stamp);
            await rename(entry.item.path, backupPath);
            backups.push({ id: entry.item.id, originalPath: entry.item.path, backupPath });
          } catch (err) {
            if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') throw err;
          }
        }

        for (const entry of prepared) {
          await rename(entry.tempPath, entry.item.path);
          installed.push(entry);
        }
      } catch (err) {
        // Roll back the entire selection. This keeps a multi-agent import from
        // leaving a half-applied configuration set when one rename fails.
        const rollbackErrors = [];
        for (const entry of [...installed].reverse()) {
          await unlink(entry.item.path).catch((rollbackErr) => rollbackErrors.push(rollbackErr));
        }
        for (const backup of [...backups].reverse()) {
          await rename(backup.backupPath, backup.originalPath).catch((rollbackErr) => rollbackErrors.push(rollbackErr));
        }
        for (const entry of prepared) {
          await unlink(entry.tempPath).catch((rollbackErr) => {
            if (rollbackErr?.code !== 'ENOENT') rollbackErrors.push(rollbackErr);
          });
        }
        const rollbackNote = rollbackErrors.length
          ? `; rollback was incomplete (${rollbackErrors.map((rollbackErr) => rollbackErr?.message || rollbackErr).join('; ')})`
          : '; all changes were rolled back';
        throw new AgentConfigError(`configuration import failed: ${err?.message || err}${rollbackNote}`, {
          code: 'IMPORT_FAILED',
          status: 500,
        });
      }

      return {
        imported: installed.map(({ item }) => ({ id: item.id, path: item.path })),
        backups,
      };
    },
  };
}
