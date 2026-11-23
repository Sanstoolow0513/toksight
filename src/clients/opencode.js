import os from 'node:os';
import path from 'node:path';
import { walkFiles, readJson, pathExists } from '../fsutils.js';
import { openSqliteReadOnly } from './sqlite.js';

export const id = 'opencode';
export const label = 'OpenCode';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  const base =
    env.OPENCODE_PATH ||
    path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode');
  return [base];
}

// OpenCode v1.2+ keeps sessions and messages in <base>/opencode.db (SQLite:
// `message` rows hold a JSON `data` column, joined with `session` for
// directory/title). Newer releases moved them to `session_message` (typed
// rows; assistant data has `model: { id, providerID }`) joined with
// `session_v2`; both layouts are read, and a message id present in both is
// counted once. v1.1.x wrote one JSON file per message under
// <base>/storage/message/ — still supported as a fallback for when the db is
// absent or cannot be read (e.g. Node without node:sqlite), never both, so
// messages are never double counted. SQLite-era rows hardcode `cost: 0` as a placeholder,
// so only non-zero self-reported costs are honored there.
export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const base = scanRoots[0];
  const warnings = [];

  const dbEntries = await collectFromDb(base, warnings);
  if (dbEntries) return { entries: dbEntries, warnings };

  const entries = await collectFromJson(path.join(base, 'storage', 'message'), warnings);
  return { entries, warnings };
}

async function collectFromDb(base, warnings) {
  const dbPath = path.join(base, 'opencode.db');
  // A missing db just means OpenCode's v1.2+ layout was never used — fall back
  // to legacy storage silently; the warning fires only when the db exists but
  // cannot be read (locked, or Node without node:sqlite).
  if (!(await pathExists(dbPath))) return null;

  let db;
  try {
    db = await openSqliteReadOnly(dbPath);
  } catch (err) {
    warnings.push(`opencode: database unreadable (${err.message}), falling back to legacy JSON storage`);
    return null;
  }

  const entries = [];
  const seen = new Set();
  try {
    // Keep the two layouts at the same SQLite snapshot during a migration.
    db.exec('BEGIN');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
    if (!tables.has('session_message') && !tables.has('message')) {
      warnings.push('opencode: message table unavailable (no message or session_message table)');
    }

    for (const [messages, sessions] of [['session_message', 'session_v2'], ['message', 'session']]) {
      if (!tables.has(messages)) continue;
      const current = messages === 'session_message';
      const hasSessions = tables.has(sessions);
      const metadata = hasSessions ? 's.directory, s.title' : 'NULL AS directory, NULL AS title';
      const join = hasSessions ? `LEFT JOIN ${sessions} s ON s.id = m.session_id` : '';
      // Older databases can lack a message ID. Retain their original usage rows.
      const columns = current ? 'm.id, m.session_id, m.time_created, m.data' : 'm.*';
      const query = `SELECT ${columns}, ${metadata} FROM ${messages} m ${join}
                     ${current ? "WHERE m.type = 'assistant'" : ''}`;
      try {
        for (const row of db.prepare(query).iterate()) {
          if (!current && seen.has(row.id)) continue;
          const entry = dbEntry(row, current);
          if (!entry) continue;
          entries.push(entry);
          if (current && row.id != null && tables.has('message')) seen.add(row.id);
        }
      } catch (err) {
        warnings.push(`opencode: ${messages} table unavailable (${err.message})`);
      }
    }
  } catch (err) {
    warnings.push(`opencode: database schema unavailable (${err.message})`);
  } finally {
    db.close();
  }
  return entries;
}

function dbEntry(row, current) {
  let data;
  try {
    data = JSON.parse(row.data);
  } catch {
    return null;
  }
  if (!data?.tokens || (!current && data.role !== 'assistant')) return null;
  const tokens = data.tokens;
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const cacheRead = tokens.cache?.read ?? 0;
  const cacheWrite = tokens.cache?.write ?? 0;
  const reasoning = tokens.reasoning ?? 0;
  if (![input, output, cacheRead, cacheWrite, reasoning].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  if (!input && !output && !cacheRead && !cacheWrite) return null;

  const model = current ? data.model?.id : data.modelID;
  const providerId = current ? data.model?.providerID : data.providerID;
  const timestamp = [data.time?.completed, data.time?.created, row.time_created].find(Number.isFinite);
  return {
    client: id,
    sessionId: row.session_id,
    model: typeof model === 'string' && model ? model : 'unknown',
    ...(typeof providerId === 'string' ? { providerId } : {}),
    timestamp: timestamp ?? null,
    inputTokens: input,
    outputTokens: output,
    reasoningTokens: reasoning,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd: Number.isFinite(data.cost) && data.cost > 0 ? data.cost : null,
    directory: row.directory ?? data.path?.cwd ?? null,
    title: row.title ?? null,
  };
}

// Legacy v1.1.x layout: one JSON file per message. Assistant messages carry a
// `tokens` object and, when the provider pricing was known to OpenCode, a
// precomputed `cost` — honored as-is (a missing/zero cost there is real).
async function collectFromJson(root, warnings) {
  const entries = [];
  const { files, warnings: walkWarnings } = await walkFiles(root, { filter: (name) => name.endsWith('.json') });
  warnings.push(...walkWarnings);

  for (const file of files) {
    let o = null;
    try {
      o = await readJson(file);
    } catch {
      continue;
    }
    if (!o || o.role !== 'assistant') continue;
    const tokens = o.tokens || {};
    const cache = tokens.cache || {};
    const input = tokens.input ?? 0;
    const output = tokens.output ?? 0;
    const cacheRead = cache.read ?? 0;
    const cacheWrite = cache.write ?? 0;
    if (!input && !output && !cacheRead && !cacheWrite) continue;

    entries.push({
      client: id,
      sessionId: o.sessionID || path.basename(path.dirname(file)),
      model: o.modelID || 'unknown',
      ...(typeof o.providerID === 'string' ? { providerId: o.providerID } : {}),
      timestamp: o.time?.created ?? null,
      inputTokens: input,
      outputTokens: output,
      reasoningTokens: tokens.reasoning ?? 0,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      costUsd: typeof o.cost === 'number' ? o.cost : null,
      directory: null,
      title: null,
    });
  }
  return entries;
}
