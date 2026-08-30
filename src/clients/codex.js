import os from 'node:os';
import path from 'node:path';
import { walkFiles, readJsonl } from '../fsutils.js';

export const id = 'codex';
export const label = 'Codex CLI';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  const base = env.CODEX_HOME || path.join(home, '.codex');
  return [path.join(base, 'sessions')];
}

// Codex CLI rollout files live under ~/.codex/sessions/YYYY/MM/DD/*.jsonl.
// Usage arrives as cumulative `total_token_usage` snapshots plus
// `last_token_usage` (the latest request). We prefer `last_token_usage` and
// fall back to diffing cumulative totals. `cached_input_tokens` is a subset of
// `input_tokens`, so fresh input = input - cached.
export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const warnings = [];
  const entries = [];

  const files = [];
  for (const root of scanRoots) {
    files.push(...(await walkFiles(root, { filter: (name) => name.endsWith('.jsonl') })));
  }

  for (const file of files) {
    let sessionId = path.basename(file, '.jsonl');
    let directory = null;
    let model = null;
    let prevTotal = null;

    await readJsonl(file, (o) => {
      if (!o) return;
      const payload = o.payload && typeof o.payload === 'object' ? o.payload : null;
      const type = payload?.type || o.type;

      if (type === 'session_meta') {
        sessionId = payload?.id || sessionId;
        if (payload?.cwd) directory = payload.cwd;
        return;
      }
      if (type === 'turn_context') {
        if (payload?.model) model = payload.model;
        return;
      }
      if (type !== 'token_count') return;

      const info = payload?.info || o.info;
      if (!info) return;

      const toCounts = (u) => ({
        input: u.input_tokens ?? 0,
        cached: u.cached_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        reasoning: u.reasoning_output_tokens ?? 0,
      });
      const total = info.total_token_usage ? toCounts(info.total_token_usage) : null;
      const last = info.last_token_usage ? toCounts(info.last_token_usage) : null;

      let delta;
      if (last) {
        delta = last;
      } else if (total && prevTotal) {
        delta = {
          input: total.input - prevTotal.input,
          cached: total.cached - prevTotal.cached,
          output: total.output - prevTotal.output,
          reasoning: total.reasoning - prevTotal.reasoning,
        };
      }
      if (total) prevTotal = total;
      if (!delta) return;

      const { input, cached, output, reasoning } = delta;
      if (input <= 0 && output <= 0 && cached <= 0) return;

      entries.push({
        client: id,
        sessionId,
        model: model || 'unknown',
        timestamp: o.timestamp ? Date.parse(o.timestamp) : null,
        inputTokens: Math.max(0, input - cached),
        outputTokens: Math.max(0, output),
        reasoningTokens: Math.max(0, reasoning || 0),
        cacheReadTokens: Math.max(0, cached),
        cacheWriteTokens: 0,
        costUsd: null,
        directory,
        title: null,
      });
    });
  }

  return { entries, warnings };
}
