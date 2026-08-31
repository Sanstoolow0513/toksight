import os from 'node:os';
import path from 'node:path';
import { walkFiles, readJsonl, readJson } from '../fsutils.js';

export const id = 'kimi';
export const label = 'Kimi Code';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  const base = env.KIMI_CODE_HOME || path.join(home, '.kimi-code');
  return [path.join(base, 'sessions')];
}

// Kimi Code appends a wire-protocol log per agent under
// ~/.kimi-code/sessions/<workspace>/<session>/agents/<agent>/wire.jsonl.
// `usage.record` lines carry one entry per LLM request (not cumulative, no
// repetition, so no dedupe/diff needed). usageScope splits conversation turns
// from session-level requests (e.g. title generation) — both are real spend.
// Kimi fields: inputOther (fresh input), output, inputCacheRead,
// inputCacheCreation. Session metadata (id, cwd, title) lives in the
// session's state.json; agents within a session share it.
export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const warnings = [];
  const entries = [];
  const stateCache = new Map();

  const readState = async (sessionDir) => {
    if (stateCache.has(sessionDir)) return stateCache.get(sessionDir);
    let state = null;
    try {
      const parsed = await readJson(path.join(sessionDir, 'state.json'));
      state = parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      state = null;
    }
    stateCache.set(sessionDir, state);
    return state;
  };

  const files = [];
  for (const root of scanRoots) {
    files.push(...(await walkFiles(root, { filter: (name) => name === 'wire.jsonl' })));
  }

  for (const file of files) {
    // .../sessions/<workspace>/<session>/agents/<agent>/wire.jsonl
    const sessionDir = path.dirname(path.dirname(path.dirname(file)));
    const state = await readState(sessionDir);
    const sessionId =
      (state && typeof state.id === 'string' && state.id) || path.basename(sessionDir);
    const directory =
      (state && typeof state.cwd === 'string' && state.cwd) ||
      path.basename(path.dirname(sessionDir));
    const title = (state && typeof state.title === 'string' && state.title) || null;

    await readJsonl(file, (o) => {
      if (!o || o.type !== 'usage.record') return;
      const usage = o.usage;
      if (!usage || typeof usage !== 'object') return;
      const input = usage.inputOther ?? 0;
      const output = usage.output ?? 0;
      const cacheRead = usage.inputCacheRead ?? 0;
      const cacheWrite = usage.inputCacheCreation ?? 0;
      if (!input && !output && !cacheRead && !cacheWrite) return;
      const time = typeof o.time === 'number' ? o.time : o.time ? Date.parse(o.time) : NaN;

      entries.push({
        client: id,
        sessionId,
        model: o.model || 'unknown',
        timestamp: Number.isFinite(time) ? time : null,
        inputTokens: input,
        outputTokens: output,
        reasoningTokens: 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: null,
        directory,
        title,
      });
    });
  }

  return { entries, warnings };
}
