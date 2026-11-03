import os from 'node:os';
import path from 'node:path';
import { walkFilesMany, readJsonl, readJson } from '../fsutils.js';
import { durationFields } from '../tps.js';

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
//
// Request duration is measured (durationSource 'measured'): Kimi logs an
// `llm.request` line when it sends each request and the `usage.record` when
// that request completes. A usage record pairs with the latest earlier
// request for the same model in the same wire log; earlier unmatched
// requests are failed attempts that were retried and are dropped.
//
// providerId comes from that same paired request. Requests are matched by
// model, never by `kind` vs `usageScope` (they use different vocabularies:
// `loop` requests report `turn` usage). Older logs name the configured
// provider in `provider` and repeat the usage model in `model`; newer logs put
// the upstream name in `model`, the configured `<provider>/<model>` key in
// `modelAlias` (the usage model) and the wire protocol (e.g. `openai`) in
// `provider`, so there the configured namespace is used instead.
function requestProvider(request, model) {
  if (!request || typeof model !== 'string' || !model) return null;
  if (request.model === model) return typeof request.provider === 'string' && request.provider ? request.provider : null;
  if (request.modelAlias !== model) return null;
  const slash = model.indexOf('/');
  return slash > 0 ? model.slice(0, slash) : null;
}

export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const entries = [];
  const stateCache = new Map();
  const stateWarnings = []; // readState pushes as it discovers bad state.json files

  const readState = async (sessionDir) => {
    if (stateCache.has(sessionDir)) return stateCache.get(sessionDir);
    let state = null;
    try {
      const parsed = await readJson(path.join(sessionDir, 'state.json'));
      state = parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      // Missing state.json is normal (older sessions); anything else —
      // unreadable file, malformed JSON — deserves a warning.
      state = null;
      if (err?.code !== 'ENOENT') {
        stateWarnings.push(`kimi: cannot read ${path.join(sessionDir, 'state.json')} (${err?.code || err?.message || err})`);
      }
    }
    stateCache.set(sessionDir, state);
    return state;
  };

  const { files, warnings } = await walkFilesMany(scanRoots, {
    filter: (name) => name === 'wire.jsonl',
  });

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
    const agentId = path.basename(path.dirname(file));
    const agentOf = (o) => o.agentId ?? agentId;
    let sent = [];
    const latest = new Map();
    await readJsonl(file, (o) => {
      if (o?.type === 'llm.request') {
        latest.set(agentOf(o), o);
        if (typeof o.time === 'number' && Number.isFinite(o.time)) sent.push({ time: o.time, agent: agentOf(o), models: [o.model, o.modelAlias], request: o });
        return;
      }
      if (!o || o.type !== 'usage.record') return;
      const usage = o.usage;
      if (!usage || typeof usage !== 'object') return;
      const input = usage.inputOther ?? 0;
      const output = usage.output ?? 0;
      const cacheRead = usage.inputCacheRead ?? 0;
      const cacheWrite = usage.inputCacheCreation ?? 0;
      if (!input && !output && !cacheRead && !cacheWrite) return;
      const time = typeof o.time === 'number' ? o.time : o.time ? Date.parse(o.time) : NaN;
      let timing = {};
      let request = null;
      if (Number.isFinite(time)) {
        const at = sent.findLastIndex((r) => r.time <= time && r.agent === agentOf(o) && r.models.includes(o.model));
        if (at >= 0) {
          request = sent[at].request;
          timing = durationFields(sent[at].time, time, 'measured');
          sent = sent.filter((r, i) => i > at || r.agent !== agentOf(o) || !r.models.includes(o.model));
        }
      }
      if (!request) {
        // Untimed lines, or a second record for an already paired request.
        const last = latest.get(agentOf(o));
        if (last && [last.model, last.modelAlias].includes(o.model)) request = last;
      }
      const providerId = requestProvider(request, o.model);

      entries.push({
        client: id,
        sessionId,
        model: o.model || 'unknown',
        ...(providerId ? { providerId } : {}),
        timestamp: Number.isFinite(time) ? time : null,
        inputTokens: input,
        outputTokens: output,
        reasoningTokens: 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        costUsd: null,
        directory,
        title,
        ...timing,
      });
    });
  }

  return { entries, warnings: [...warnings, ...stateWarnings] };
}
