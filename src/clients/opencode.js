import os from 'node:os';
import path from 'node:path';
import { walkFiles, readJson } from '../fsutils.js';

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
// directory/title). v1.1.x wrote one JSON file per message under
// <base>/storage/message/ — still supported as a fallback for when the db
// cannot be read (e.g. Node without node:sqlite), never both, so messages are
// never double counted. SQLite-era rows hardcode `cost: 0` as a placeholder,
// so only non-zero self-reported costs are honored there.
export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const base = scanRoots[0];
  const warnings = [];

  const dbEntries = await collectFromDb(base, warnings);
  if (dbEntries) return { entries: dbEntries, warnings };

  const entries = await collectFromJson(path.join(base, 'storage', 'message'));
  return { entries, warnings };
}

async function collectFromDb(base, warnings) {
  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(path.join(base, 'opencode.db'), { readOnly: true });
  } catch (err) {
    warnings.push(`opencode: database unreadable (${err.message}), falling back to legacy JSON storage`);
    return null;
  }

  try {
    let rows;
    try {
      rows = db
        .prepare(
          `SELECT m.session_id, m.data,
                  s.directory AS session_directory, s.title AS session_title
           FROM message m LEFT JOIN session s ON s.id = m.session_id`,
        )
        .all();
    } catch (err) {
      warnings.push(`opencode: message table unavailable (${err.message})`);
      return [];
    }

    const entries = [];
    for (const r of rows) {
      let o;
      try {
        o = JSON.parse(r.data);
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
        sessionId: r.session_id,
        model: o.modelID || 'unknown',
        timestamp: o.time?.completed ?? o.time?.created ?? null,
        inputTokens: input,
        outputTokens: output,
        reasoningTokens: tokens.reasoning ?? 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: typeof o.cost === 'number' && o.cost > 0 ? o.cost : null,
        directory: r.session_directory ?? o.path?.cwd ?? null,
        title: r.session_title ?? null,
      });
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

// Legacy v1.1.x layout: one JSON file per message. Assistant messages carry a
// `tokens` object and, when the provider pricing was known to OpenCode, a
// precomputed `cost` — honored as-is (a missing/zero cost there is real).
async function collectFromJson(root) {
  const entries = [];
  const files = await walkFiles(root, { filter: (name) => name.endsWith('.json') });

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
