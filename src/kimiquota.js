// Kimi Code subscription quota, fetched on demand from the Kimi Code API.
//
// There is no quota data in local Kimi files, so this is the one quota source
// that needs the network. It only runs for an explicit `toksight quota` or a
// Web quota refresh, never during usage collection. The OAuth access token is
// read from Kimi Code's own credential file at call time, sent only as a
// Bearer header to the Kimi Code API host, and never logged, returned or
// persisted. toksight never refreshes the token or writes the file: Kimi
// rotates refresh tokens, so only Kimi Code itself may renew them.
//
// Response shape (GET <base>/usages), per kimi-cli's /usage command and
// CodexBar's parser:
//   { user: { membership: { level } },
//     usage:  { limit, used, remaining, resetTime },            // weekly quota
//     limits: [{ window: { duration, timeUnit }, detail: { limit, used, remaining, resetTime } }],
//     usages: { limit_5h | limit_7d | limit_month_total: { used_ratio, reset_time } } }
// Numbers usually arrive as strings. Anything unrecognised is ignored.

import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { emptySnapshot, finiteNumber, makeWindow, quotaError } from './quotamodel.js';

const pkg = createRequire(import.meta.url)('../package.json');

export const KIMI_DEFAULT_BASE_URL = 'https://api.kimi.com/coding/v1';
// The token is only ever sent to Kimi Code's own API hosts.
const KIMI_API_HOSTS = new Set(['api.kimi.com', 'api.kimi.ai']);
const EXPIRY_MARGIN_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 8_000;

export function kimiHome({ env = process.env, home = os.homedir() } = {}) {
  return env.KIMI_CODE_HOME || path.join(home, '.kimi-code');
}

export function kimiCredentialPath(opts) {
  return path.join(kimiHome(opts), 'credentials', 'kimi-code.json');
}

function allowedBaseUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    return url.protocol === 'https:' && KIMI_API_HOSTS.has(url.hostname) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

// KIMI_CODE_BASE_URL, then the first Kimi Code `base_url` in config.toml,
// then the China default. Non-Kimi hosts are ignored so the token never
// leaves Kimi's API.
export async function kimiBaseUrl({ env = process.env, home } = {}) {
  const candidates = [];
  if (env.KIMI_CODE_BASE_URL) candidates.push(env.KIMI_CODE_BASE_URL);
  try {
    const toml = await readFile(path.join(kimiHome({ env, home }), 'config.toml'), 'utf8');
    for (const match of toml.matchAll(/^\s*base_url\s*=\s*["']([^"'\n]+)["']/gm)) candidates.push(match[1]);
  } catch { /* no config: use the default */ }
  for (const raw of candidates) {
    const url = allowedBaseUrl(raw);
    if (url && /\/coding(\/v1)?\/?$/.test(url.pathname)) return url.href.replace(/\/+$/, '');
  }
  return KIMI_DEFAULT_BASE_URL;
}

export function kimiUsageUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/coding') ? `${base}/v1/usages` : `${base}/usages`;
}

// expires_at is epoch seconds in kimi-cli (time.time() + expires_in); accept
// milliseconds too.
export function expiresAtMs(value) {
  const n = finiteNumber(value);
  if (n == null || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

const UNIT_MINUTES = { TIME_UNIT_SECOND: 1 / 60, TIME_UNIT_MINUTE: 1, TIME_UNIT_HOUR: 60, TIME_UNIT_DAY: 1440 };

function durationMinutes(window) {
  if (!window || typeof window !== 'object') return null;
  const duration = finiteNumber(window.duration);
  if (duration == null || duration <= 0) return null;
  const unit = String(window.timeUnit ?? window.time_unit ?? 'TIME_UNIT_MINUTE').toUpperCase();
  const key = Object.keys(UNIT_MINUTES).find((k) => unit === k || unit.includes(k.replace('TIME_UNIT_', '')));
  return key ? duration * UNIT_MINUTES[key] : null;
}

const resetOf = (d) => d?.resetTime ?? d?.resetAt ?? d?.reset_time ?? d?.reset_at ?? null;

function countWindow(detail, ident, windowMinutes, now) {
  if (!detail || typeof detail !== 'object') return null;
  const limit = finiteNumber(detail.limit);
  let used = finiteNumber(detail.used);
  const remaining = finiteNumber(detail.remaining);
  if (used == null && remaining != null && limit != null) used = limit - remaining;
  if (used == null && limit == null) return null;
  const usedPercent = limit > 0 && used != null ? (used / limit) * 100 : null;
  return makeWindow({ ...ident, windowMinutes, usedPercent, used, limit, remaining, resetsAt: resetOf(detail) }, now);
}

const POOLS = {
  limit_5h: { minutes: 300 },
  limit_7d: { minutes: 10080 },
  limit_month_total: { id: 'month', label: 'month' },
};

export function parseKimiUsage(body, now = Date.now()) {
  const windows = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { plan: null, windows };
  const add = (window) => {
    if (!window) return;
    const same = windows.find((w) => w.id === window.id);
    if (!same) { windows.push(window); return; }
    // Count and ratio readings of one window: keep counts, show the more exhausted percentage.
    if (window.usedPercent != null && (same.usedPercent == null || window.usedPercent > same.usedPercent)) same.usedPercent = window.usedPercent;
    for (const key of ['used', 'limit', 'remaining']) if (same[key] == null && window[key] != null) same[key] = window[key];
    if (!same.resetsAt && window.resetsAt) same.resetsAt = window.resetsAt;
  };
  if (Array.isArray(body.limits)) {
    for (const item of body.limits) {
      if (!item || typeof item !== 'object') continue;
      const minutes = durationMinutes(item.window);
      add(countWindow(item.detail && typeof item.detail === 'object' ? item.detail : item, minutes ? {} : { id: 'window', label: 'window' }, minutes, now));
    }
  }
  // `usage` is the weekly quota (kimi-cli labels it "Weekly limit").
  if (body.usage && typeof body.usage === 'object') add(countWindow(body.usage, {}, 10080, now));
  if (body.usages && typeof body.usages === 'object' && !Array.isArray(body.usages)) {
    for (const [key, pool] of Object.entries(body.usages)) {
      if (!pool || typeof pool !== 'object') continue;
      const ratio = finiteNumber(pool.used_ratio ?? pool.usedRatio);
      if (ratio == null || ratio < 0) continue;
      const known = POOLS[key];
      const ident = known?.id ? { id: known.id, label: known.label } : known ? {} : { id: key.replace(/^limit_/, ''), label: key.replace(/^limit_/, '') };
      add(makeWindow({ ...ident, windowMinutes: known?.minutes ?? null, usedPercent: ratio * 100, resetsAt: resetOf(pool) }, now));
    }
  }
  windows.sort((a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity));
  const level = body.user?.membership?.level;
  const plan = typeof level === 'string' && level.trim() && level !== 'LEVEL_UNSPECIFIED' ? level.trim() : null;
  return { plan, windows };
}

export async function kimiQuota({ env = process.env, home = os.homedir(), now = Date.now(), fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const snapshot = emptySnapshot('kimi', 'api', now);
  const fail = (code, message) => { snapshot.error = quotaError(code, message); return snapshot; };

  let credentials;
  try {
    credentials = JSON.parse(await readFile(kimiCredentialPath({ env, home }), 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') return fail('KIMI_NO_CREDENTIALS', 'not signed in: no Kimi Code credentials found (sign in with Kimi Code first)');
    return fail('KIMI_BAD_CREDENTIALS', `cannot read Kimi Code credentials (${err?.code || 'invalid JSON'})`);
  }
  const token = typeof credentials?.access_token === 'string' ? credentials.access_token.trim() : '';
  if (!token) return fail('KIMI_NO_CREDENTIALS', 'Kimi Code credentials have no access token (sign in with Kimi Code first)');
  const expires = expiresAtMs(credentials.expires_at);
  if (expires != null && expires <= now + EXPIRY_MARGIN_MS) return fail('KIMI_TOKEN_EXPIRED', 'token expired, open Kimi Code to refresh');
  if (typeof fetchImpl !== 'function') return fail('KIMI_NETWORK', 'fetch is not available in this Node.js runtime');

  const url = kimiUsageUrl(await kimiBaseUrl({ env, home }));
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': `toksight/${pkg.version}` },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return fail('KIMI_TIMEOUT', `Kimi usage request timed out after ${Math.round(timeoutMs / 1000)}s`);
    return fail('KIMI_NETWORK', `network error: ${err?.cause?.code || err?.code || err?.message || 'request failed'}`);
  }
  if (response.status === 401 || response.status === 403) return fail('KIMI_UNAUTHORIZED', `Kimi rejected the token (HTTP ${response.status}); open Kimi Code to refresh`);
  if (response.status === 404) return fail('KIMI_UNSUPPORTED', 'usage endpoint not available for this account (HTTP 404)');
  if (!response.ok) return fail('KIMI_HTTP', `Kimi usage request failed (HTTP ${response.status})`);
  let body;
  try { body = await response.json(); }
  catch { return fail('KIMI_BAD_RESPONSE', 'Kimi usage response is not JSON'); }
  const { plan, windows } = parseKimiUsage(body, now);
  snapshot.plan = plan;
  snapshot.windows = windows;
  snapshot.observedAt = snapshot.fetchedAt;
  if (!windows.length) {
    const keys = body && typeof body === 'object' ? Object.keys(body).slice(0, 8).join(', ') : typeof body;
    return fail('KIMI_UNSUPPORTED_RESPONSE', `unsupported Kimi usage response (fields: ${keys || 'none'})`);
  }
  return snapshot;
}
