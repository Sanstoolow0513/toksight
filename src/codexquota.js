// Codex subscription quota, read offline from rollout JSONL files.
//
// `event_msg` lines with payload.type === 'token_count' may carry
// `rate_limits` ({ limit_id, primary, secondary, plan_type, ... }). The quota
// snapshot is the latest one by event timestamp across every session. This is
// independent of `info`: older Codex versions write `info: null` (usage
// collection skips those lines) while still reporting rate limits.

import { stat } from 'node:fs/promises';
import { readJsonl, walkFilesMany } from './fsutils.js';
import { sourceRoots } from './clients/codex.js';
import { emptySnapshot, finiteNumber, makeWindow, quotaError } from './quotamodel.js';

// Seconds or milliseconds epoch, or an ISO string, to ms.
function epochMs(value) {
  if (typeof value === 'string' && !/^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  const n = finiteNumber(value);
  if (n == null || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

// One Codex window in any known spelling. Returns null when it carries no
// usable percentage and no length.
function readWindow(raw, observedAt, now) {
  if (!raw || typeof raw !== 'object') return null;
  const usedPercent = finiteNumber(raw.used_percent ?? raw.usedPercent);
  const windowMinutes = finiteNumber(raw.window_minutes ?? raw.windowMinutes);
  if (usedPercent == null && windowMinutes == null) return null;
  let resetsAt = epochMs(raw.resets_at ?? raw.resetsAt ?? raw.reset_at);
  const relative = finiteNumber(raw.resets_in_seconds ?? raw.reset_after_seconds ?? raw.resetsInSeconds);
  if (resetsAt == null && relative != null && Number.isFinite(observedAt)) resetsAt = observedAt + relative * 1000;
  return makeWindow({ windowMinutes, usedPercent, resetsAt, observedAt }, now);
}

// Current nested shape plus the early flat one
// (primary_used_percent / primary_window_minutes / ...).
export function parseCodexRateLimits(rl, observedAt, now = Date.now()) {
  if (!rl || typeof rl !== 'object') return { windows: [], plan: null };
  const slot = (name) => {
    if (rl[name] && typeof rl[name] === 'object') return rl[name];
    const flat = {
      used_percent: rl[`${name}_used_percent`],
      window_minutes: rl[`${name}_window_minutes`],
      resets_in_seconds: rl[`${name}_resets_in_seconds`] ?? rl[`${name}_reset_after_seconds`],
      resets_at: rl[`${name}_resets_at`],
    };
    return Object.values(flat).some((v) => v != null) ? flat : null;
  };
  const windows = [];
  for (const name of ['primary', 'secondary']) {
    const window = readWindow(slot(name), observedAt, now);
    if (!window) continue;
    // Two windows of unknown length must still be distinguishable.
    if (windows.some((w) => w.id === window.id)) { window.id = `${window.id}-${name}`; }
    windows.push(window);
  }
  windows.sort((a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity));
  const plan = typeof rl.plan_type === 'string' && rl.plan_type ? rl.plan_type : null;
  return { windows, plan };
}

export async function codexQuota({ env = process.env, home, now = Date.now(), roots } = {}) {
  const snapshot = emptySnapshot('codex', 'local', now);
  const scanRoots = roots ?? sourceRoots({ env, home });
  const { files, warnings } = await walkFilesMany(scanRoots, { filter: (name) => name.endsWith('.jsonl') });
  const dated = [];
  for (const file of files) {
    try { dated.push({ file, mtime: (await stat(file)).mtimeMs }); } catch { /* vanished mid-scan */ }
  }
  // Newest files first; a file last written before the best event so far
  // cannot hold a later one (one minute of slack for clock skew).
  dated.sort((a, b) => b.mtime - a.mtime);
  let best = null;
  for (const { file, mtime } of dated) {
    if (best && mtime < best.ts - 60_000) break;
    try {
      await readJsonl(file, (o) => {
        if (!o || typeof o !== 'object') return;
        const payload = o.payload && typeof o.payload === 'object' ? o.payload : null;
        if ((payload?.type || o.type) !== 'token_count') return;
        const rl = payload?.rate_limits ?? o.rate_limits;
        if (!rl || typeof rl !== 'object') return;
        const parsedTs = o.timestamp ? Date.parse(o.timestamp) : NaN;
        const ts = Number.isFinite(parsedTs) ? parsedTs : mtime;
        // Snapshots without any window (e.g. credits only) do not replace one that has them.
        if ((!best || ts >= best.ts) && parseCodexRateLimits(rl, ts, now).windows.length) best = { ts, rl };
      });
    } catch (err) {
      warnings.push(`codex: cannot read ${file} (${err?.code || err?.message || err})`);
    }
  }
  if (warnings.length) snapshot.warnings = warnings;
  if (!best) {
    snapshot.error = quotaError('CODEX_NO_RATE_LIMITS', files.length
      ? 'no rate-limit data in Codex sessions (needs a recent Codex version and at least one request)'
      : 'no Codex sessions found');
    return snapshot;
  }
  const { windows, plan } = parseCodexRateLimits(best.rl, best.ts, now);
  snapshot.observedAt = new Date(best.ts).toISOString();
  snapshot.plan = plan;
  snapshot.windows = windows;
  if (typeof best.rl.limit_id === 'string' && best.rl.limit_id) snapshot.limitId = best.rl.limit_id;
  return snapshot;
}
