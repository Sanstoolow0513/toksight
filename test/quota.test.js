import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { codexQuota, parseCodexRateLimits } from '../src/codexquota.js';
import { expiresAtMs, kimiBaseUrl, kimiQuota, kimiUsageUrl, parseKimiUsage } from '../src/kimiquota.js';
import { collectQuotas } from '../src/quota.js';
import { makeWindow, windowIdentity } from '../src/quotamodel.js';
import { parseArgs } from '../src/args.js';
import { compactDuration } from '../src/format.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'quota');
const NOW = Date.parse('2026-10-26T15:00:00Z');
const TOKEN = 'kimi-secret-access-token-123';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-quota-'));
}

// Writes a Codex rollout under <home>/.codex/sessions and sets its mtime.
function writeRollout(home, name, lines, mtime = NOW) {
  const dir = path.join(home, '.codex', 'sessions', '2026', '10', '26');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.map((l) => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') + '\n');
  fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
}

const tokenCount = (timestamp, rateLimits, info = { last_token_usage: { input_tokens: 10, output_tokens: 1 } }) =>
  ({ timestamp, type: 'event_msg', payload: { type: 'token_count', info, rate_limits: rateLimits } });

test('window ids follow window length, not the provider slot', () => {
  assert.deepEqual(windowIdentity(300), { id: '5h', label: '5h' });
  assert.deepEqual(windowIdentity(10080), { id: 'week', label: 'week' });
  assert.deepEqual(windowIdentity(120), { id: '2h', label: '2h' });
  assert.deepEqual(windowIdentity(2880), { id: '2d', label: '2d' });
  assert.deepEqual(windowIdentity(45), { id: '45m', label: '45m' });
  assert.deepEqual(windowIdentity(null), { id: 'window', label: 'window' });
  assert.equal(compactDuration(3 * 86400_000 + 4 * 3600_000 + 59_000), '3d 4h');
  assert.equal(compactDuration(2 * 3600_000 + 5 * 60_000), '2h 5m');
  assert.equal(compactDuration(30_000), '<1m');
});

test('codex: weekly-only primary from a real rollout line (no 5h window)', async () => {
  const home = tmpHome();
  const dir = path.join(home, '.codex', 'sessions', '2026', '10', '26');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'codex-rollout-weekly.jsonl'), path.join(dir, 'rollout-a.jsonl'));
  const q = await codexQuota({ env: {}, home, now: NOW });
  assert.equal(q.client, 'codex');
  assert.equal(q.source, 'local');
  assert.equal(q.plan, 'self_serve_business_prolite');
  assert.equal(q.observedAt, '2026-10-26T14:16:29.286Z');
  assert.equal(q.error, undefined);
  assert.equal(q.windows.length, 1);
  assert.deepEqual(q.windows[0], { id: 'week', label: 'week', windowMinutes: 10080, usedPercent: 4, resetsAt: '2026-11-02T08:46:21.000Z', reset: false });
});

test('codex: 5h + weekly windows are classified by window_minutes in either slot', async () => {
  const home = tmpHome();
  writeRollout(home, 'rollout-b.jsonl', [tokenCount('2026-10-26T14:00:00Z', {
    plan_type: 'pro',
    primary: { used_percent: 61.5, window_minutes: 10080, resets_at: Math.floor(Date.parse('2026-10-30T00:00:00Z') / 1000) },
    secondary: { used_percent: 12, window_minutes: 300, resets_at: Math.floor(Date.parse('2026-10-26T17:00:00Z') / 1000) },
  })]);
  const q = await codexQuota({ env: {}, home, now: NOW });
  assert.deepEqual(q.windows.map((w) => [w.id, w.usedPercent, w.resetsAt]), [
    ['5h', 12, '2026-10-26T17:00:00.000Z'],
    ['week', 61.5, '2026-10-30T00:00:00.000Z'],
  ]);
});

test('codex: latest snapshot wins across sessions; info:null and resets_in_seconds are handled', async () => {
  const home = tmpHome();
  writeRollout(home, 'rollout-old.jsonl', [tokenCount('2026-10-26T10:00:00Z', {
    primary: { used_percent: 90, window_minutes: 300, resets_at: Math.floor(Date.parse('2026-10-26T16:00:00Z') / 1000) },
  })], Date.parse('2026-10-26T10:00:01Z'));
  // Older Codex: info is null on the line that carries the limits, and the
  // reset is relative to the event.
  writeRollout(home, 'rollout-new.jsonl', [
    tokenCount('2026-10-26T14:30:00Z', { primary: { used_percent: 20, window_minutes: 300, resets_in_seconds: 3600 } }, null),
    '{not json',
  ], Date.parse('2026-10-26T14:30:01Z'));
  const q = await codexQuota({ env: {}, home, now: NOW });
  assert.equal(q.observedAt, '2026-10-26T14:30:00.000Z');
  assert.deepEqual(q.windows.map((w) => [w.id, w.usedPercent, w.resetsAt]), [['5h', 20, '2026-10-26T15:30:00.000Z']]);
  assert.equal(q.plan, null);
});

test('codex: an older file with a later event still wins over mtime order', async () => {
  const home = tmpHome();
  // mtime is earlier than the other file but within the event window, so it is still read.
  writeRollout(home, 'rollout-x.jsonl', [tokenCount('2026-10-26T14:50:00Z', { primary: { used_percent: 7, window_minutes: 10080 } })], Date.parse('2026-10-26T14:50:00Z'));
  writeRollout(home, 'rollout-y.jsonl', [tokenCount('2026-10-26T14:40:00Z', { primary: { used_percent: 3, window_minutes: 10080 } })], Date.parse('2026-10-26T14:55:00Z'));
  const q = await codexQuota({ env: {}, home, now: NOW });
  assert.equal(q.windows[0].usedPercent, 7);
});

test('codex: early flat rate_limits shape and CODEX_HOME override', async () => {
  const home = tmpHome();
  const codexHome = path.join(home, 'custom-codex');
  const dir = path.join(codexHome, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'r.jsonl'), JSON.stringify(tokenCount('2026-10-26T14:00:00Z', {
    primary_used_percent: 33, primary_window_minutes: 300, secondary_used_percent: 5, secondary_window_minutes: 10080,
  })) + '\n');
  const q = await codexQuota({ env: { CODEX_HOME: codexHome }, home, now: NOW });
  assert.deepEqual(q.windows.map((w) => [w.id, w.usedPercent]), [['5h', 33], ['week', 5]]);
});

test('codex: sessions without rate_limits report a clear error, not a crash', async () => {
  const home = tmpHome();
  writeRollout(home, 'rollout-c.jsonl', [
    tokenCount('2026-10-26T14:00:00Z', undefined),
    tokenCount('2026-10-26T14:01:00Z', null, null),
    tokenCount('2026-10-26T14:02:00Z', { primary: null, secondary: null, credits: { has_credits: true } }),
    { type: 'event_msg', payload: { type: 'agent_message' } },
  ]);
  const q = await codexQuota({ env: {}, home, now: NOW });
  assert.deepEqual(q.windows, []);
  assert.equal(q.error.code, 'CODEX_NO_RATE_LIMITS');
  const none = await codexQuota({ env: {}, home: tmpHome(), now: NOW });
  assert.equal(none.error.code, 'CODEX_NO_RATE_LIMITS');
  assert.match(none.error.message, /no Codex sessions/);
});

test('codex: a reset time in the past rolls the window over instead of showing a stale percent', async () => {
  const home = tmpHome();
  writeRollout(home, 'rollout-d.jsonl', [tokenCount('2026-10-26T08:00:00Z', {
    primary: { used_percent: 95, window_minutes: 300, resets_at: Math.floor(Date.parse('2026-10-26T12:00:00Z') / 1000) },
    // No reset time, but observed more than a week ago relative to its length? No: still current.
    secondary: { used_percent: 40, window_minutes: 10080 },
  })], Date.parse('2026-10-26T08:00:00Z'));
  const q = await codexQuota({ env: {}, home, now: NOW });
  const [fiveHour, week] = q.windows;
  assert.deepEqual(fiveHour, { id: '5h', label: '5h', windowMinutes: 300, usedPercent: null, resetsAt: '2026-10-26T12:00:00.000Z', reset: true });
  assert.equal(week.usedPercent, 40);
  assert.equal(week.reset, false);
  // Without a reset time, an observation older than the window has rolled over too.
  const stale = parseCodexRateLimits({ primary: { used_percent: 50, window_minutes: 300 } }, Date.parse('2026-10-26T01:00:00Z'), NOW);
  assert.equal(stale.windows[0].reset, true);
  assert.equal(stale.windows[0].usedPercent, null);
});

test('makeWindow clamps percentages and drops counts after a rollover', () => {
  assert.equal(makeWindow({ windowMinutes: 300, usedPercent: 140 }, NOW).usedPercent, 100);
  assert.equal(makeWindow({ windowMinutes: 300, usedPercent: -3 }, NOW).usedPercent, 0);
  const rolled = makeWindow({ windowMinutes: 300, usedPercent: 50, used: 5, limit: 10, resetsAt: '2026-10-26T00:00:00Z' }, NOW);
  assert.equal(rolled.used, undefined);
  assert.equal(rolled.reset, true);
});

// ---- Kimi -------------------------------------------------------------

function kimiHome({ expiresAt = Math.floor(NOW / 1000) + 900, config } = {}) {
  const home = tmpHome();
  const base = path.join(home, '.kimi-code');
  fs.mkdirSync(path.join(base, 'credentials'), { recursive: true });
  fs.writeFileSync(path.join(base, 'credentials', 'kimi-code.json'), JSON.stringify({
    access_token: TOKEN, refresh_token: 'kimi-refresh-token', expires_at: expiresAt, scope: 'kimi-code', token_type: 'Bearer', expires_in: 900,
  }));
  if (config) fs.writeFileSync(path.join(base, 'config.toml'), config);
  return home;
}

function fakeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, init }); return respond(url, init); };
  impl.calls = calls;
  return impl;
}

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fixture = () => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'kimi-usages.json'), 'utf8'));

test('kimi: parses counts, ratio pools and membership from the documented shape', () => {
  const { plan, windows } = parseKimiUsage(fixture(), NOW);
  assert.equal(plan, 'LEVEL_INTERMEDIATE');
  assert.deepEqual(windows.map((w) => w.id), ['5h', 'week', 'month']);
  const [fiveHour, week, month] = windows;
  // Count 139/200 = 69.5% beats the ratio pool's 60%; counts are kept.
  assert.equal(fiveHour.usedPercent, 69.5);
  assert.equal(fiveHour.used, 139);
  assert.equal(fiveHour.limit, 200);
  assert.equal(fiveHour.resetsAt, '2026-10-26T17:33:02.717Z');
  assert.equal(week.windowMinutes, 10080);
  assert.equal(week.used, 214);
  assert.equal(week.limit, 2048);
  assert.ok(Math.abs(week.usedPercent - 10.449) < 0.01);
  assert.ok(Math.abs(month.usedPercent - 0.56) < 1e-9);
  assert.equal(month.resetsAt, '2026-11-17T00:00:00.000Z');
});

test('kimi: tolerant parsing of numbers, remaining-only details, units and unknown shapes', () => {
  const { windows } = parseKimiUsage({
    limits: [
      { window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' }, detail: { limit: 100, remaining: '75', reset_at: '2026-10-26T18:00:00Z' } },
      { window: { duration: 1, timeUnit: 'TIME_UNIT_DAY' }, detail: { limit: 'x' } },
      'junk',
    ],
    usages: { limit_7d: { used_ratio: 0.125 }, limit_month_code: { used_ratio: 0 }, limit_bad: { used_ratio: -1 } },
  }, NOW);
  assert.deepEqual(windows.map((w) => [w.id, w.usedPercent, w.used ?? null]), [['5h', 25, 25], ['week', 12.5, null], ['month_code', 0, null]]);
  assert.deepEqual(parseKimiUsage({ hello: 1 }, NOW).windows, []);
  assert.deepEqual(parseKimiUsage(null, NOW).windows, []);
  assert.deepEqual(parseKimiUsage([1, 2], NOW).windows, []);
});

test('kimi: fetches with the Bearer token only, never exposes it, and honors a Kimi base_url', async () => {
  const home = kimiHome({ config: '[providers.kimi]\nbase_url = "https://evil.example/coding/v1"\n\n[providers.kimi2]\nbase_url = "https://api.kimi.ai/coding/v1"\n' });
  const fetchImpl = fakeFetch(() => jsonResponse(fixture()));
  const q = await kimiQuota({ env: {}, home, now: NOW, fetchImpl });
  assert.equal(fetchImpl.calls.length, 1);
  const [{ url, init }] = fetchImpl.calls;
  assert.equal(url, 'https://api.kimi.ai/coding/v1/usages');
  assert.equal(init.method, 'GET');
  assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(q.source, 'api');
  assert.equal(q.plan, 'LEVEL_INTERMEDIATE');
  assert.equal(q.windows.length, 3);
  assert.equal(q.error, undefined);
  assert.ok(!JSON.stringify(q).includes(TOKEN));
  assert.ok(!JSON.stringify(q).includes('kimi-refresh-token'));
});

test('kimi: base URL defaults and override rules', async () => {
  assert.equal(await kimiBaseUrl({ env: {}, home: tmpHome() }), 'https://api.kimi.com/coding/v1');
  assert.equal(await kimiBaseUrl({ env: { KIMI_CODE_BASE_URL: 'http://api.kimi.com/coding/v1' }, home: tmpHome() }), 'https://api.kimi.com/coding/v1');
  assert.equal(await kimiBaseUrl({ env: { KIMI_CODE_BASE_URL: 'https://api.kimi.ai/coding/v1/' }, home: tmpHome() }), 'https://api.kimi.ai/coding/v1');
  assert.equal(kimiUsageUrl('https://api.kimi.com/coding'), 'https://api.kimi.com/coding/v1/usages');
  assert.equal(kimiUsageUrl('https://api.kimi.com/coding/v1/'), 'https://api.kimi.com/coding/v1/usages');
});

test('kimi: expired token is reported without any request (seconds or milliseconds)', async () => {
  assert.equal(expiresAtMs(1793609181), 1793609181000);
  assert.equal(expiresAtMs(1793609181000), 1793609181000);
  assert.equal(expiresAtMs('1793609181.5'), 1793609181500);
  assert.equal(expiresAtMs(null), null);
  for (const expiresAt of [Math.floor(NOW / 1000) - 60, NOW - 60_000, Math.floor(NOW / 1000) + 10]) {
    const fetchImpl = fakeFetch(() => { throw new Error('must not fetch'); });
    const q = await kimiQuota({ env: {}, home: kimiHome({ expiresAt }), now: NOW, fetchImpl });
    assert.equal(q.error.code, 'KIMI_TOKEN_EXPIRED');
    assert.equal(q.error.message, 'token expired, open Kimi Code to refresh');
    assert.equal(fetchImpl.calls.length, 0);
  }
});

test('kimi: missing or broken credential file, KIMI_CODE_HOME override', async () => {
  const fetchImpl = fakeFetch(() => { throw new Error('must not fetch'); });
  const missing = await kimiQuota({ env: {}, home: tmpHome(), now: NOW, fetchImpl });
  assert.equal(missing.error.code, 'KIMI_NO_CREDENTIALS');
  const home = tmpHome();
  fs.mkdirSync(path.join(home, 'k', 'credentials'), { recursive: true });
  fs.writeFileSync(path.join(home, 'k', 'credentials', 'kimi-code.json'), '{oops');
  const broken = await kimiQuota({ env: { KIMI_CODE_HOME: path.join(home, 'k') }, home, now: NOW, fetchImpl });
  assert.equal(broken.error.code, 'KIMI_BAD_CREDENTIALS');
  fs.writeFileSync(path.join(home, 'k', 'credentials', 'kimi-code.json'), '{"refresh_token":"r"}');
  const noAccess = await kimiQuota({ env: { KIMI_CODE_HOME: path.join(home, 'k') }, home, now: NOW, fetchImpl });
  assert.equal(noAccess.error.code, 'KIMI_NO_CREDENTIALS');
  assert.equal(fetchImpl.calls.length, 0);
});

test('kimi: network errors, timeouts, HTTP failures and unsupported bodies', async () => {
  const home = kimiHome();
  const run = (respond) => kimiQuota({ env: {}, home, now: NOW, fetchImpl: fakeFetch(respond) });
  const network = await run(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
  assert.equal(network.error.code, 'KIMI_NETWORK');
  assert.match(network.error.message, /ENOTFOUND/);
  const timeout = await run(() => { throw new DOMException('timed out', 'TimeoutError'); });
  assert.equal(timeout.error.code, 'KIMI_TIMEOUT');
  assert.equal((await run(() => jsonResponse({ error: 'x' }, 401))).error.code, 'KIMI_UNAUTHORIZED');
  assert.equal((await run(() => jsonResponse({}, 404))).error.code, 'KIMI_UNSUPPORTED');
  assert.equal((await run(() => jsonResponse({}, 502))).error.code, 'KIMI_HTTP');
  assert.equal((await run(() => new Response('<html>', { status: 200 }))).error.code, 'KIMI_BAD_RESPONSE');
  const odd = await run(() => jsonResponse({ quota: { percent: 3 } }));
  assert.equal(odd.error.code, 'KIMI_UNSUPPORTED_RESPONSE');
  assert.match(odd.error.message, /quota/);
  for (const q of [network, timeout, odd]) assert.ok(!JSON.stringify(q).includes(TOKEN));
});

test('collectQuotas never calls the network when offline or network:false', async () => {
  const home = kimiHome();
  const fetchImpl = fakeFetch(() => jsonResponse(fixture()));
  const offline = await collectQuotas({ offline: true }, { env: {}, home, now: () => NOW, fetchImpl });
  assert.deepEqual(offline.map((q) => q.client), ['codex', 'kimi']);
  assert.equal(offline[1].error.code, 'KIMI_OFFLINE');
  const local = await collectQuotas({ network: false, clients: ['kimi'] }, { env: {}, home, now: () => NOW, fetchImpl });
  assert.equal(local[0].error.code, 'KIMI_NOT_FETCHED');
  assert.equal(fetchImpl.calls.length, 0);
  let cached = null;
  const kimiCache = { get: () => cached, set: (v) => { cached = v; } };
  const online = await collectQuotas({ clients: ['kimi'] }, { env: {}, home, now: () => NOW, fetchImpl, kimiCache });
  assert.equal(online[0].windows.length, 3);
  assert.equal(fetchImpl.calls.length, 1);
  const again = await collectQuotas({ clients: ['kimi'], network: false }, { env: {}, home, now: () => NOW, fetchImpl, kimiCache });
  assert.equal(again[0], cached);
  assert.equal(fetchImpl.calls.length, 1);
});

test('quota command arguments', () => {
  assert.equal(parseArgs(['quota']).command, 'quota');
  assert.equal(parseArgs(['quota']).clients, null);
  assert.deepEqual(parseArgs(['quota', '--client', 'kimi-code,codex']).clients, ['kimi', 'codex']);
  assert.equal(parseArgs(['quota', '--offline', '--json']).offline, true);
  assert.throws(() => parseArgs(['quota', '--client', 'claude']), /quota supports only codex, kimi/);
  assert.throws(() => parseArgs(['quota', '--today']), /date filters are not supported/);
});
