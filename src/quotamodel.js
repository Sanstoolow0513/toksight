// Provider-neutral subscription quota (rate-limit window) model.
//
// QuotaSnapshot {
//   client, label, plan, fetchedAt (ISO), observedAt (ISO|null),
//   source: 'local' | 'api',
//   windows: [{ id, label, windowMinutes, usedPercent, used?, limit?, remaining?, resetsAt (ISO|null), reset }],
//   error?: { code, message }
// }
//
// `usedPercent` is 0–100. A window whose reset time has passed (or whose
// observation is older than the window itself) has rolled over: `reset` is
// true and `usedPercent` is null, so a stale percentage is never shown.

export const QUOTA_CLIENTS = ['codex', 'kimi'];
export const QUOTA_LABELS = { codex: 'Codex CLI', kimi: 'Kimi Code' };

const WINDOW_IDS = { 300: '5h', 10080: 'week' };

// Window ids follow the length, never the provider's slot name: Codex plans
// may put the weekly window in `primary` with no 5-hour window at all.
export function windowIdentity(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return { id: 'window', label: 'window' };
  if (WINDOW_IDS[m]) return { id: WINDOW_IDS[m], label: WINDOW_IDS[m] };
  const label = m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`;
  return { id: label, label };
}

const toIso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

export function finiteNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

// Builds a window and applies the rollover rule against `now`.
export function makeWindow({ id, label, windowMinutes = null, usedPercent = null, used = null, limit = null, remaining = null,
  resetsAt = null, observedAt = null }, now = Date.now()) {
  const ident = id ? { id, label: label || id } : windowIdentity(windowMinutes);
  let percent = finiteNumber(usedPercent);
  if (percent != null) percent = Math.min(100, Math.max(0, percent));
  const resetMs = resetsAt == null ? NaN : typeof resetsAt === 'number' ? resetsAt : Date.parse(resetsAt);
  const minutes = finiteNumber(windowMinutes);
  const rolledOver = Number.isFinite(resetMs)
    ? resetMs <= now
    : Number.isFinite(observedAt) && minutes != null && observedAt + minutes * 60_000 <= now;
  const window = {
    id: ident.id,
    label: ident.label,
    windowMinutes: minutes,
    usedPercent: rolledOver ? null : percent,
    resetsAt: toIso(resetMs),
    reset: rolledOver,
  };
  if (!rolledOver) {
    if (used != null) window.used = used;
    if (limit != null) window.limit = limit;
    if (remaining != null) window.remaining = remaining;
  }
  return window;
}

export function emptySnapshot(client, source, now = Date.now()) {
  return { client, label: QUOTA_LABELS[client] ?? client, plan: null, source, fetchedAt: toIso(now), observedAt: null, windows: [] };
}

export function quotaError(code, message) {
  return { code, message };
}

export function resolveQuotaClients(clients) {
  if (!clients) return null;
  const bad = clients.filter((id) => !QUOTA_CLIENTS.includes(id));
  if (bad.length) throw new Error(`quota supports only ${QUOTA_CLIENTS.join(', ')} (got ${bad.join(', ')})`);
  return clients;
}
