import os from 'node:os';
import path from 'node:path';
import { listDirectory, readJsonl, walkFiles } from '../fsutils.js';

export const id = 'antigravity';
export const label = 'Antigravity CLI';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  const base = env.ANTIGRAVITY_CLI_DIR || path.join(home, '.gemini', 'antigravity-cli');
  return [path.join(base, 'brain'), path.join(base, 'conversations')];
}

function usageEntry(row, sessionId) {
  if (!Number.isSafeInteger(row?.step_index) || row.step_index < 0) return null;
  const { input_tokens: input = 0, cache_read_tokens: cached = 0, output_tokens: output = 0 } = row;
  if (![input, cached, output].every(n => Number.isSafeInteger(n) && n >= 0) || !(input || cached || output)) return null;
  const time = Date.parse(row.created_at);
  return {
    client: id, sessionId, model: typeof row.model === 'string' && row.model || 'unknown',
    timestamp: Number.isFinite(time) ? time : null,
    inputTokens: input, cacheReadTokens: cached, outputTokens: output,
    reasoningTokens: 0, cacheWriteTokens: 0, costUsd: null, directory: null, title: null,
  };
}

export async function collect({ env, home, roots } = {}) {
  const [brain, conversations] = roots ?? sourceRoots({ env, home });
  const entries = [];
  const warnings = [];
  const transcripts = new Set();
  for (const session of await listDirectory(brain, warnings)) {
    if (!session.isDirectory()) continue;
    const logs = path.join(brain, session.name, '.system_generated', 'logs');
    const found = await walkFiles(logs, { maxDepth: 2, filter: name => name.endsWith('.jsonl') });
    for (const warning of found.warnings) warnings.push(warning);
    const steps = new Map();
    for (const file of found.files) {
      const relative = path.relative(logs, file).split(path.sep).join('/');
      if (!/^(?:transcript(?:_full)?|chunks\/transcript(?:_full)?\/\d+)\.jsonl$/.test(relative)) continue;
      try {
        await readJsonl(file, row => {
          const entry = usageEntry(row, session.name);
          if (entry) steps.set(row.step_index, entry);
        });
        transcripts.add(session.name);
      } catch (err) {
        warnings.push(`antigravity: cannot read ${file} (${err.code || err.message})`);
      }
    }
    for (const entry of steps.values()) entries.push(entry);
  }
  for (const db of await listDirectory(conversations, warnings)) {
    if (db.isFile() && db.name.endsWith('.db') && !transcripts.has(path.basename(db.name, '.db'))) {
      warnings.push(`antigravity: no readable transcript for ${db.name}; database-only history is not collected`);
    }
  }
  return { entries, warnings };
}
