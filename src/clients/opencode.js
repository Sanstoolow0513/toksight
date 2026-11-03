import os from 'node:os';
import path from 'node:path';
import { walkFiles, readJson, pathExists } from '../fsutils.js';
import { openSqliteReadOnly } from './sqlite.js';
import { durationFields } from '../tps.js';

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
// Assistant messages record `time.created` and `time.completed`, so request
// durations are measured (durationSource 'measured').
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

  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const entries = [];
    const seen = new Set();
    // Current layout first: v2 rows win over an older `message` copy of the same id.
    if (tables.has('session_message')) {
      let rows;
      try {
        rows = db
          .prepare(
            `SELECT m.id, m.session_id, m.data, m.time_created,
                    ${tables.has('session_v2') ? 's.directory AS session_directory, s.title AS session_title' : 'NULL AS session_directory, NULL AS session_title'}
             FROM session_message m ${tables.has('session_v2') ? 'LEFT JOIN session_v2 s ON s.id = m.session_id' : ''}
             WHERE m.type = 'assistant'`,
          )
          .all();
      } catch (err) {
        warnings.push(`opencode: session_message table unavailable (${err.message})`);
        rows = [];
      }
      for (const r of rows) {
        const entry = sessionMessageEntry(r);
        if (r.id != null) seen.add(r.id);
        if (entry) entries.push(entry);
      }
    }
    if (tables.has('message')) {
      let rows;
      try {
        rows = db
          .prepare(
            `SELECT m.*, ${tables.has('session') ? 's.directory AS session_directory, s.title AS session_title' : 'NULL AS session_directory, NULL AS session_title'}
             FROM message m ${tables.has('session') ? 'LEFT JOIN session s ON s.id = m.session_id' : ''}`,
          )
          .all();
      } catch (err) {
        warnings.push(`opencode: message table unavailable (${err.message})`);
        rows = [];
      }
      for (const r of rows) {
        if (r.id != null && seen.has(r.id)) continue;
        const entry = messageEntry(r);
        if (entry) entries.push(entry);
      }
    }
    if (!tables.has('message') && !tables.has('session_message')) {
      warnings.push('opencode: message table unavailable (no message or session_message table)');
    }
    return entries;
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

// Shared row shape: OpenCode-era token counts with `cache.read`/`cache.write`
// split out; `cost: 0` is a placeholder in SQLite rows, so only non-zero
// self-reported costs are kept.
function dbEntry({ sessionId, model, providerId, time, tokens = {}, cost, directory, title }) {
  const cache = tokens.cache || {};
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const cacheRead = cache.read ?? 0;
  const cacheWrite = cache.write ?? 0;
  if (!input && !output && !cacheRead && !cacheWrite) return null;
  const ts = time?.completed ?? time?.created ?? null;
  return {
    client: id,
    sessionId,
    model: model || 'unknown',
    ...(typeof providerId === 'string' ? { providerId } : {}),
    timestamp: Number.isFinite(ts) ? ts : null,
    inputTokens: input,
    outputTokens: output,
    reasoningTokens: tokens.reasoning ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd: typeof cost === 'number' && cost > 0 ? cost : null,
    directory: directory ?? null,
    title: title ?? null,
    ...durationFields(time?.created, time?.completed, 'measured'),
  };
}

function parseData(text) {
  try {
    const o = JSON.parse(text);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

// v1.2+ `message` rows: { role, modelID, providerID, tokens, cost, time, path }.
function messageEntry(r) {
  const o = parseData(r.data);
  if (!o || o.role !== 'assistant') return null;
  return dbEntry({ sessionId: r.session_id, model: o.modelID, providerId: o.providerID, time: o.time, tokens: o.tokens,
    cost: o.cost, directory: r.session_directory ?? o.path?.cwd, title: r.session_title });
}

// Current `session_message` rows (type 'assistant', sessions in `session_v2`):
// { time: { created, completed }, model: { id, providerID }, tokens, cost }.
function sessionMessageEntry(r) {
  const o = parseData(r.data);
  if (!o) return null;
  const model = o.model && typeof o.model === 'object' ? o.model : {};
  const time = o.time && typeof o.time === 'object' ? o.time : { created: r.time_created };
  return dbEntry({ sessionId: r.session_id, model: model.id, providerId: model.providerID, time, tokens: o.tokens,
    cost: o.cost, directory: r.session_directory, title: r.session_title });
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
      ...durationFields(o.time?.created, o.time?.completed, 'measured'),
    });
  }
  return entries;
}
