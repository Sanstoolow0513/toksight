import os from 'node:os';
import path from 'node:path';
import { walkFilesMany, readJsonl } from '../fsutils.js';
import { durationFields } from '../tps.js';

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
//
// Request duration is inferred (durationSource 'inferred'): a request starts
// at the latest input item (user/developer message, tool output, previous
// usage marker) before its first output item (reasoning, assistant message,
// tool call) and ends at the first usage marker after it — the
// `token_usage_record` newer Codex writes on completion, else `token_count`.
// Outputs that an input interrupts before any usage marker (aborted turns,
// replayed history) are discarded instead of stretching the next request.
const OUTPUT_ITEMS = new Set(['reasoning', 'function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call', 'agent_message', 'agent_reasoning']);
const INPUT_ITEMS = new Set(['function_call_output', 'custom_tool_call_output', 'local_shell_call_output', 'user_message', 'task_started', 'turn_aborted']);
function itemKind(o, payload) {
  const type = payload?.type;
  if (type === 'message') return payload.role === 'assistant' ? 'output' : payload.role === 'user' || payload.role === 'developer' ? 'input' : null;
  if (o.type === 'response_item' || o.type === 'event_msg') {
    if (OUTPUT_ITEMS.has(type)) return 'output';
    if (INPUT_ITEMS.has(type)) return 'input';
  }
  return null;
}
export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const entries = [];

  const { files, warnings } = await walkFilesMany(scanRoots, {
    filter: (name) => name.endsWith('.jsonl'),
  });

  for (const file of files) {
    let sessionId = path.basename(file, '.jsonl');
    let directory = null;
    let model = null;
    let providerId = null;
    let prevTotal = null;
    let lastInputAt = NaN, requestStart = NaN, usageAt = NaN, outputs = false;

    await readJsonl(file, (o) => {
      if (!o) return;
      const payload = o.payload && typeof o.payload === 'object' ? o.payload : null;
      const type = payload?.type || o.type;
      const lineTs = o.timestamp ? Date.parse(o.timestamp) : NaN;
      const kind = itemKind(o, payload);
      if (kind === 'input') {
        if (outputs && !Number.isFinite(usageAt)) { outputs = false; requestStart = NaN; }
        if (Number.isFinite(lineTs)) lastInputAt = lineTs;
      } else if (kind === 'output' && Number.isFinite(usageAt) && lastInputAt > usageAt) {
        // A new response began before the previous cycle's token_count:
        // pairing is ambiguous, so the next token_count gets no duration.
        requestStart = NaN; usageAt = NaN;
      } else if (kind === 'output' && !outputs) {
        outputs = true;
        requestStart = lastInputAt;
      }
      if (o.type === 'token_usage_record' && outputs) {
        if (Number.isFinite(usageAt)) requestStart = NaN; // two completions, one token_count
        else usageAt = lineTs;
      }

      if (type === 'session_meta') {
        sessionId = payload?.id || sessionId;
        if (payload?.cwd) directory = payload.cwd;
        if (typeof payload?.model_provider === 'string') providerId = payload.model_provider;
        return;
      }
      if (type === 'turn_context') {
        if (payload?.model) model = payload.model;
        return;
      }
      if (type !== 'token_count') return;

      const info = payload?.info || o.info;
      if (!info) return;
      // A usage marker closes the request cycle whether or not it yields a row.
      const end = Number.isFinite(usageAt) ? usageAt : lineTs;
      const timing = outputs ? durationFields(requestStart, end, 'inferred') : {};
      outputs = false; requestStart = NaN; usageAt = NaN;
      if (Number.isFinite(lineTs)) lastInputAt = lineTs;

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

      // Contract: ms epoch or null; NaN from a malformed timestamp must not
      // leak past the date filters (see claude.js).
      const ts = o.timestamp ? Date.parse(o.timestamp) : null;
      entries.push({
        client: id,
        sessionId,
        model: model || 'unknown',
        ...(providerId ? { providerId } : {}),
        timestamp: Number.isFinite(ts) ? ts : null,
        inputTokens: Math.max(0, input - cached),
        outputTokens: Math.max(0, output),
        reasoningTokens: Math.max(0, reasoning || 0),
        cacheReadTokens: Math.max(0, cached),
        cacheWriteTokens: 0,
        costUsd: null,
        directory,
        title: null,
        ...timing,
      });
    });
  }

  return { entries, warnings };
}
