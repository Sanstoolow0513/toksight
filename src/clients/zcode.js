import os from 'node:os';
import path from 'node:path';
import { walkFiles, readJsonl, pathExists } from '../fsutils.js';
import { openSqliteReadOnly } from './sqlite.js';

export const id = 'zcode';
export const label = 'ZCode';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  const base = env.ZCODE_HOME || path.join(home, '.zcode');
  return [base];
}

// ZCode v2 keeps per-request usage in ~/.zcode/cli/db/db.sqlite
// (model_usage table, joined with `session` for directory/title). The SQLite
// database is the source of truth; ~/.zcode/cli/rollout/model-io-*.jsonl files
// carry the same data and are only used when the database is absent or cannot
// be read (e.g. Node without node:sqlite) so requests are never double counted.
// input_tokens counts the whole prompt with cache reads included (rollout
// totalTokens = input + output + cacheWrite), so cache reads are subtracted
// to emit fresh input like every other client.
export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const base = scanRoots[0];
  const warnings = [];

  const dbEntries = await collectFromDb(base, warnings);
  if (dbEntries) return { entries: dbEntries, warnings };

  const entries = await collectFromRollout(base, warnings);
  return { entries, warnings };
}

async function collectFromDb(base, warnings) {
  const dbPath = path.join(base, 'cli', 'db', 'db.sqlite');
  // A missing db just means ZCode never wrote one — fall back to rollout
  // silently; the warning fires only when the db exists but cannot be read
  // (locked, or Node without node:sqlite).
  if (!(await pathExists(dbPath))) return null;

  let db;
  try {
    db = await openSqliteReadOnly(dbPath);
  } catch (err) {
    warnings.push(`zcode: database unreadable (${err.message}), falling back to rollout logs`);
    return null;
  }

  try {
    let rows;
    try {
      rows = db
        .prepare(
          `SELECT mu.session_id, mu.model_id, mu.started_at, mu.completed_at,
                  mu.input_tokens, mu.output_tokens, mu.reasoning_tokens,
                  mu.cache_creation_input_tokens, mu.cache_read_input_tokens,
                  s.directory AS session_directory, s.title AS session_title
           FROM model_usage mu LEFT JOIN session s ON s.id = mu.session_id`,
        )
        .all();
    } catch (err) {
      warnings.push(`zcode: model_usage table unavailable (${err.message})`);
      return [];
    }

    const entries = [];
    for (const r of rows) {
      const input = r.input_tokens ?? 0;
      const output = r.output_tokens ?? 0;
      const cacheRead = r.cache_read_input_tokens ?? 0;
      const cacheWrite = r.cache_creation_input_tokens ?? 0;
      if (!input && !output && !cacheRead && !cacheWrite) continue;
      entries.push({
        client: id,
        sessionId: r.session_id,
        model: r.model_id || 'unknown',
        timestamp: r.completed_at ?? r.started_at ?? null,
        inputTokens: Math.max(0, input - cacheRead),
        outputTokens: output,
        reasoningTokens: r.reasoning_tokens ?? 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: null,
        directory: r.session_directory ?? null,
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

async function collectFromRollout(base, warnings) {
  const dir = path.join(base, 'cli', 'rollout');
  const { files, warnings: walkWarnings } = await walkFiles(dir, { filter: (name) => name.endsWith('.jsonl') });
  warnings.push(...walkWarnings);
  const entries = [];

  for (const file of files) {
    await readJsonl(file, (o) => {
      if (!o || o.type !== 'model_io') return;
      const usage = o.response?.usage;
      if (!usage) return;
      const input = usage.inputTokens ?? 0;
      const output = usage.outputTokens ?? 0;
      const cacheRead = usage.cacheReadTokens ?? 0;
      const cacheWrite = usage.cacheWriteTokens ?? 0;
      if (!input && !output && !cacheRead && !cacheWrite) return;
      // Contract: ms epoch or null; NaN from a malformed timestamp must not
      // leak past the date filters (see claude.js).
      const ts = o.completedAt ? Date.parse(o.completedAt) : o.startedAt ? Date.parse(o.startedAt) : null;
      entries.push({
        client: id,
        sessionId: o.sessionId || path.basename(file, '.jsonl'),
        model: o.model?.modelId || 'unknown',
        timestamp: Number.isFinite(ts) ? ts : null,
        inputTokens: Math.max(0, input - cacheRead),
        outputTokens: output,
        reasoningTokens: 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: null,
        directory: null,
        title: null,
      });
    });
  }
  return entries;
}
