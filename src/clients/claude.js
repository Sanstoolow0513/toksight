import os from 'node:os';
import path from 'node:path';
import { walkFilesMany, readJsonl } from '../fsutils.js';
import { durationFields } from '../tps.js';

export const id = 'claude';
export const label = 'Claude Code';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  const base = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return [path.join(base, 'projects')];
}

// Claude Code writes one JSONL transcript per session under
// ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl. Assistant lines carry a
// `message.usage` object with Anthropic-style token fields. Assistant lines can
// repeat per message id (one line per content block, or a streaming partial
// followed by the final snapshot) — dedupe by message id, keeping the snapshot
// with the largest usage so partials never undercount.
//
// Request duration is inferred (durationSource 'inferred'): Claude logs one
// timestamp per line, so a request starts at the `user` line (prompt or
// tool_result) its first assistant line points to via parentUuid, and ends
// at the last line written for that message id. Requests whose parent is
// missing or not a user line (sidechain hops, system lines) get no duration.
export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const entries = [];
  const seen = new Map(); // dedupe key -> index of the kept entry

  const { files, warnings } = await walkFilesMany(scanRoots, {
    filter: (name) => name.endsWith('.jsonl'),
  });

  for (const file of files) {
    const lines = new Map(); // uuid -> { type, ts, messageId }
    const spans = new Map(); // entries index -> { start, end }
    await readJsonl(file, (o) => {
      if (!o) return;
      const lineTs = o.timestamp ? Date.parse(o.timestamp) : NaN;
      if (typeof o.uuid === 'string') lines.set(o.uuid, { type: o.type, ts: lineTs, parent: o.parentUuid, messageId: o.message?.id ?? null });
      if (o.type !== 'assistant') return;
      const msg = o.message;
      const usage = msg && msg.usage;
      if (!usage) return;
      const input = usage.input_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const cacheWrite = usage.cache_creation_input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      if (!input && !cacheRead && !cacheWrite && !output) return;

      // Contract: ms epoch or null. Date.parse yields NaN on a malformed
      // timestamp string — normalize to null so date filters (and JSON
      // output) treat it as "no timestamp" instead of a valid value.
      const ts = o.timestamp ? Date.parse(o.timestamp) : null;

      const entry = {
        client: id,
        sessionId: o.sessionId || path.basename(file, '.jsonl'),
        model: msg.model || 'unknown',
        timestamp: Number.isFinite(ts) ? ts : null,
        inputTokens: input,
        outputTokens: output,
        reasoningTokens: 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        ...(Number.isSafeInteger(usage.cache_creation?.ephemeral_1h_input_tokens) && usage.cache_creation.ephemeral_1h_input_tokens >= 0 && usage.cache_creation.ephemeral_1h_input_tokens <= cacheWrite
          ? { cacheWrite1hTokens: usage.cache_creation.ephemeral_1h_input_tokens } : {}),
        costUsd: null,
        directory: path.basename(path.dirname(file)),
        title: null,
      };

      const messageId = msg.id || '';
      const key = `${o.sessionId || file}/${messageId}`;
      if (messageId) {
        const idx = seen.get(key);
        if (idx !== undefined) {
          const span = spans.get(idx);
          if (span && Number.isFinite(lineTs)) span.end = Math.max(span.end, lineTs);
          const kept = entries[idx];
          const keptTotal =
            kept.inputTokens + kept.cacheReadTokens + kept.cacheWriteTokens + kept.outputTokens;
          const total = input + cacheRead + cacheWrite + output;
          if (total > keptTotal) entries[idx] = entry;
          return;
        }
        seen.set(key, entries.length);
      }
      const start = requestStart(lines, o.parentUuid, messageId);
      if (Number.isFinite(start) && Number.isFinite(lineTs)) spans.set(entries.length, { start, end: lineTs });
      entries.push(entry);
    });
    for (const [idx, { start, end }] of spans) Object.assign(entries[idx], durationFields(start, end, 'inferred'));
  }

  return { entries, warnings };
}

// Walks back over earlier lines of the same message (content blocks chain to
// each other) to the user line that triggered the request.
function requestStart(lines, parentUuid, messageId) {
  let parent = typeof parentUuid === 'string' ? lines.get(parentUuid) : null;
  for (let hops = 0; parent && hops < 64; hops++) {
    if (parent.type === 'assistant' && messageId && parent.messageId === messageId) {
      parent = typeof parent.parent === 'string' ? lines.get(parent.parent) : null;
      continue;
    }
    return parent.type === 'user' ? parent.ts : NaN;
  }
  return NaN;
}
