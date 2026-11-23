import os from 'node:os';
import path from 'node:path';
import { walkFilesMany, readJsonl } from '../fsutils.js';

export const id = 'codex';
export const label = 'Codex CLI';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  const base = env.CODEX_HOME || path.join(home, '.codex');
  return [path.join(base, 'sessions'), path.join(base, 'archived_sessions')];
}

const rolloutThread = /^rollout-.*-([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i;

async function readRollout(file) {
  const basename = path.basename(file).replace(/\.jsonl(?:\.zst)?$/, '');
  const fileId = rolloutThread.exec(basename)?.[1].toLowerCase();
  let sessionId = fileId;
  let directory = null;
  let providerId = null;
  let model = null;
  const events = [];

  await readJsonl(file, (o) => {
    if (!o) return;
    const payload = o.payload;
    const type = payload?.type || o.type;
    if (type === 'session_meta') {
      const headerId = payload?.id;
      if (typeof headerId === 'string' && headerId.trim()) {
        sessionId ??= headerId;
        // Forks can replay another thread's header in the middle of this file.
        if ((fileId ? headerId.toLowerCase() : headerId) !== sessionId) return;
      }
      if (payload?.cwd) directory = payload.cwd;
      if (typeof payload?.model_provider === 'string') providerId = payload.model_provider;
    } else if (type === 'turn_context') {
      if (payload?.model) model = payload.model;
    } else if (type === 'token_count') {
      const info = payload?.info || o.info;
      const total = info?.total_token_usage;
      const last = info?.last_token_usage;
      if (!total && !last) return;
      const time = o.timestamp ? Date.parse(o.timestamp) : null;
      events.push({
        time: Number.isFinite(time) ? time : null, rawTime: o.timestamp,
        model, directory, providerId, total, last,
      });
    }
  });
  return { sessionId: sessionId ?? basename, events };
}

// Snapshots in a plain rollout and its archived copy may serialize keys in
// different orders. Keep every token field, including cumulative counters.
function snapshotKey(usage) {
  return usage && Object.keys(usage).sort().map(key => [key, usage[key]]);
}

function mergeSegments(segments) {
  if (segments.length === 1) return segments[0];
  const events = [];
  const kept = new Map();
  for (const segment of segments) {
    const counts = new Map();
    for (const event of segment) {
      const key = JSON.stringify([event.time ?? event.rawTime, snapshotKey(event.total), snapshotKey(event.last)]);
      const index = counts.get(key) ?? 0;
      counts.set(key, index + 1);
      if (!kept.has(key)) kept.set(key, []);
      const copies = kept.get(key);
      const existing = copies[index];
      if (existing) {
        // A segment can start after the original turn context or session header.
        existing.model ??= event.model;
        existing.directory ??= event.directory;
        existing.providerId ??= event.providerId;
      } else {
        copies.push(event);
        events.push(event);
      }
    }
  }
  return events.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
}

function appendUsage(entries, sessionId, events) {
  let previous;
  for (const { time, model, directory, providerId, total, last } of events) {
    const baseline = previous;
    if (total) previous = total;
    if (!last && !baseline) continue;
    const delta = key => last ? (last[key] ?? 0) : (total[key] ?? 0) - (baseline[key] ?? 0);
    const input = delta('input_tokens');
    const cached = delta('cached_input_tokens');
    const output = delta('output_tokens');
    if (input <= 0 && output <= 0 && cached <= 0) continue;
    entries.push({
      client: id,
      sessionId,
      model: model ?? 'unknown',
      ...(providerId ? { providerId } : {}),
      timestamp: time,
      inputTokens: Math.max(0, input - cached),
      outputTokens: Math.max(0, output),
      reasoningTokens: Math.max(0, delta('reasoning_output_tokens')),
      cacheReadTokens: Math.max(0, cached),
      cacheWriteTokens: 0,
      costUsd: null,
      directory,
      title: null,
    });
  }
}

export async function collect({ env, home, roots } = {}) {
  const { files, warnings } = await walkFilesMany(roots ?? sourceRoots({ env, home }), {
    filter: name => /\.jsonl(?:\.zst)?$/.test(name),
  });
  const threads = new Map();
  for (const file of files) {
    try {
      const { sessionId, events } = await readRollout(file);
      if (!threads.has(sessionId)) threads.set(sessionId, []);
      threads.get(sessionId).push(events);
    } catch (err) {
      warnings.push(`codex: cannot read ${file} (${err.message})`);
    }
  }
  const entries = [];
  for (const [sessionId, segments] of threads) {
    appendUsage(entries, sessionId, mergeSegments(segments));
  }
  return { entries, warnings };
}
