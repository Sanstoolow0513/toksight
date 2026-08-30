import os from 'node:os';
import path from 'node:path';
import { walkFiles, readJson } from '../fsutils.js';

export const id = 'opencode';
export const label = 'OpenCode';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  const base =
    env.OPENCODE_PATH ||
    path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode');
  return [path.join(base, 'storage', 'message')];
}

// OpenCode stores one JSON file per message under
// ~/.local/share/opencode/storage/message/<sessionId>/<messageId>.json.
// Assistant messages carry a `tokens` object and, when the provider pricing is
// known to OpenCode, a precomputed `cost`. We honor that cost as-is.
export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const warnings = [];
  const entries = [];

  const files = [];
  for (const root of scanRoots) {
    files.push(...(await walkFiles(root, { filter: (name) => name.endsWith('.json') })));
  }

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

  return { entries, warnings };
}
