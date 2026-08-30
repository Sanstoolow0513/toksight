import os from 'node:os';
import path from 'node:path';
import { walkFiles, readJsonl } from '../fsutils.js';

export const id = 'claude';
export const label = 'Claude Code';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  const base = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return [path.join(base, 'projects')];
}

// Claude Code writes one JSONL transcript per session under
// ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl. Assistant lines carry a
// `message.usage` object with Anthropic-style token fields. Assistant lines can
// repeat per message id (one line per content block), so dedupe by message id.
export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const warnings = [];
  const entries = [];
  const seen = new Set();

  const files = [];
  for (const root of scanRoots) {
    files.push(...(await walkFiles(root, { filter: (name) => name.endsWith('.jsonl') })));
  }

  for (const file of files) {
    await readJsonl(file, (o) => {
      if (!o || o.type !== 'assistant') return;
      const msg = o.message;
      const usage = msg && msg.usage;
      if (!usage) return;
      const input = usage.input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const cacheWrite = usage.cache_creation_input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      if (!input && !cacheRead && !cacheWrite && !output) return;

      const messageId = msg.id || '';
      const key = `${o.sessionId || file}/${messageId}`;
      if (messageId) {
        if (seen.has(key)) return;
        seen.add(key);
      }

      entries.push({
        client: id,
        sessionId: o.sessionId || path.basename(file, '.jsonl'),
        model: msg.model || 'unknown',
        timestamp: o.timestamp ? Date.parse(o.timestamp) : null,
        inputTokens: input,
        outputTokens: output,
        reasoningTokens: 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: null,
        directory: path.basename(path.dirname(file)),
        title: null,
      });
    });
  }

  return { entries, warnings };
}
