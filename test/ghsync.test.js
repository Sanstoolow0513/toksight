import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUsageDatabase } from '../src/database.js';
import { priceRecord } from '../src/pricecatalog.js';
import { createGhProbe, createGhRunner, createGitHubBackup, gitBlobSha, MAX_SNAPSHOT_BYTES, REMOTE_PATH, resolveToken, validRepo } from '../src/ghsync.js';
import { createWebDataService } from '../src/webservice.js';
import { createWebServer } from '../src/webserver.js';
import { parseArgs } from '../src/args.js';

const TOKEN = 'github_pat_TESTTOKEN0123456789';
const API = 'https://api.github.test';
const REPO = 'me/usage-backup';
const rate = { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0.001, source: 'user' };
const entry = (extra = {}) => ({ client: 'opencode', sessionId: 'one', model: 'sync-model', timestamp: Date.parse('2026-10-12T12:00:00Z'),
  inputTokens: 100, outputTokens: 20, reasoningTokens: 0, cacheReadTokens: 10, cacheWriteTokens: 0,
  costUsd: 0.5, directory: '/project', title: 'title', ...extra });
const collected = (entries) => ({ entries, warnings: [], reportedCosts: new WeakSet(),
  pricing: { sources: { user: true }, configDir: '/fixture', priceFor: () => rate, records: [priceRecord({ ...rate, name: 'sync-model' })] } });
const GH_TOKEN = 'gho_GHCLITOKEN0123456789abcdef';
const enoent = () => Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
const noGh = async () => { throw enoent(); };
// A fake `gh`: `state` is 'missing' | 'loggedOut' | 'loggedIn' | 'hang'.
function fakeGh(state = 'loggedIn', calls = []) {
  return async (args) => {
    calls.push(args.join(' '));
    if (state === 'missing') throw enoent();
    if (state === 'hang') throw Object.assign(new Error('Command failed: gh'), { killed: true, signal: 'SIGTERM', code: null });
    if (args[0] === '--version') return 'gh version 2.103.3 (2026-10-26)\nhttps://github.com/cli/cli/releases/tag/v2.103.3';
    if (state === 'loggedOut') throw Object.assign(new Error('no oauth token found for github.com'), { code: 1 });
    if (args[0] === 'auth') { assert.deepEqual(args, ['auth', 'token', '--hostname', 'github.com']); return GH_TOKEN; }
    if (args[0] === 'config') return 'octo-cat';
    throw new Error('unexpected gh call');
  };
}
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// An in-memory GitHub: one repository, real git blob ids, fast-forward-only
// ref updates. `intercept(method, route)` can return a Response to inject a
// failure for one call.
function fakeGitHub({ isPrivate = true, empty = false } = {}) {
  const id = () => randomBytes(20).toString('hex');
  const s = { isPrivate, blobs: new Map(), trees: new Map(), commits: new Map(), ref: null, calls: [], intercept: null, offline: false };
  const commit = (files, parent, message) => {
    const tree = id(); s.trees.set(tree, files);
    const sha = id(); s.commits.set(sha, { tree, parent, message }); return sha;
  };
  const addBlob = (bytes) => { const sha = gitBlobSha(bytes); s.blobs.set(sha, bytes); return sha; };
  if (!empty) s.ref = commit(new Map([['README.md', addBlob(Buffer.from('hi'))]]), null, 'init');
  const files = () => s.ref ? s.trees.get(s.commits.get(s.ref).tree) : new Map();
  s.remote = () => { const sha = files().get(REMOTE_PATH); return sha ? s.blobs.get(sha) : null; };
  s.put = (bytes) => { const next = new Map(files()); next.set(REMOTE_PATH, addBlob(bytes)); s.ref = commit(next, s.ref, 'seed'); };
  s.fetch = async (url, init = {}) => {
    if (s.offline) throw new TypeError('fetch failed');
    const method = init.method ?? 'GET';
    const route = url.slice(API.length);
    s.calls.push(`${method} ${route.split('?')[0]}`);
    assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
    const injected = s.intercept?.(method, route);
    if (injected) return injected;
    const body = init.body ? JSON.parse(init.body) : null;
    const base = `/repos/${REPO}`;
    if (!route.startsWith(base)) return json(404, { message: 'Not Found' });
    const rest = route.slice(base.length);
    if (rest === '' && method === 'GET') return json(200, { private: s.isPrivate, default_branch: 'main' });
    if (rest.startsWith('/contents/') && method === 'GET') {
      const sha = files().get(rest.slice('/contents/'.length).split('?')[0]);
      return sha ? json(200, { type: 'file', sha, size: s.blobs.get(sha).length }) : json(404, { message: 'Not Found' });
    }
    if (rest.startsWith('/contents/') && method === 'PUT') {
      const file = rest.slice('/contents/'.length), current = files().get(file);
      if ((body.sha ?? null) !== (current ?? null)) return json(409, { message: 'sha mismatch' });
      const blob = addBlob(Buffer.from(body.content, 'base64'));
      const next = new Map(files()); next.set(file, blob);
      s.ref = commit(next, s.ref, body.message);
      return json(200, { content: { sha: blob }, commit: { sha: s.ref } });
    }
    if (rest === '/git/ref/heads/main') return s.ref ? json(200, { object: { sha: s.ref } }) : json(409, { message: 'Git Repository is empty.' });
    if (rest.startsWith('/git/commits/') && method === 'GET') return json(200, { tree: { sha: s.commits.get(rest.split('/').pop()).tree } });
    if (rest === '/git/blobs' && method === 'POST') return json(201, { sha: addBlob(Buffer.from(body.content, 'base64')) });
    if (rest.startsWith('/git/blobs/') && method === 'GET') {
      assert.equal(init.headers.accept, 'application/vnd.github.raw+json');
      return new Response(s.blobs.get(rest.split('/').pop()), { status: 200 });
    }
    if (rest === '/git/trees' && method === 'POST') {
      const next = new Map(s.trees.get(body.base_tree));
      for (const item of body.tree) next.set(item.path, item.sha);
      const sha = id(); s.trees.set(sha, next); return json(201, { sha });
    }
    if (rest === '/git/commits' && method === 'POST') {
      const sha = id(); s.commits.set(sha, { tree: body.tree, parent: body.parents[0], message: body.message }); return json(201, { sha });
    }
    if (rest === '/git/refs/heads/main' && method === 'PATCH') {
      if (s.commits.get(body.sha)?.parent !== s.ref || body.force) return json(422, { message: 'Update is not a fast forward' });
      s.ref = body.sha; return json(200, { object: { sha: s.ref } });
    }
    return json(404, { message: 'Not Found' });
  };
  return s;
}

async function setup(t, { entries = [entry()], github = fakeGitHub(), env: extraEnv = {}, configure = true, ...options } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-ghsync-'));
  const database = createUsageDatabase({ file: path.join(dir, 'usage.sqlite') });
  database.replace(collected(entries));
  t.after(async () => { database.close(); await rm(dir, { recursive: true, force: true }); });
  const env = { TOKSIGHT_CONFIG_DIR: dir, ...extraEnv };
  const backup = createGitHubBackup({ env, home: dir, database, fetchImpl: github.fetch, apiBase: API, now: () => Date.parse('2026-10-29T08:00:00Z'), ghRunner: noGh, ...options });
  if (configure) await backup.configure({ repo: REPO, token: TOKEN });
  return { dir, env, database, backup, github };
}
const rejects = (promise, code, extra = () => {}) => assert.rejects(promise, (err) => { assert.equal(err.code, code, err.message); assert.ok(!err.message.includes(TOKEN)); extra(err); return true; });

test('repository names and token precedence', () => {
  assert.equal(validRepo('me/usage-backup'), true);
  assert.equal(validRepo('me/usage.backup_1'), true);
  for (const bad of ['me', 'me/', '/repo', 'me/a/b', 'me/..', '-me/x', 'me/x y', 42]) assert.equal(validRepo(bad), false, String(bad));
  assert.deepEqual(resolveToken({ TOKSIGHT_GITHUB_TOKEN: ' a ', GITHUB_TOKEN: 'b' }, { token: 'c' }), { token: 'a', source: 'TOKSIGHT_GITHUB_TOKEN' });
  assert.deepEqual(resolveToken({ GITHUB_TOKEN: 'b' }, { token: 'c' }), { token: 'b', source: 'GITHUB_TOKEN' });
  assert.deepEqual(resolveToken({}, { token: 'c' }), { token: 'c', source: 'config' });
  assert.deepEqual(resolveToken({}, {}), { token: null, source: null });
});

test('settings are stored privately and the token is never reported back', async (t) => {
  const { backup, dir } = await setup(t, { configure: false });
  assert.deepEqual([(await backup.status()).configured, (await backup.status()).tokenSource], [false, null]);
  await assert.rejects(backup.configure({ repo: 'not a repo' }), { code: 'SYNC_BAD_REPO' });
  await assert.rejects(backup.configure({ token: 'has space inside' }), { code: 'SYNC_BAD_TOKEN' });
  await assert.rejects(backup.configure({ repo: REPO, extra: 1 }), { code: 'SYNC_BAD_CONFIG' });
  const status = await backup.configure({ repo: `https://github.com/${REPO}.git`, token: ` ${TOKEN} ` });
  assert.deepEqual([status.configured, status.repo, status.tokenSource, status.tokenSaved, status.remotePath], [true, REPO, 'config', true, REMOTE_PATH]);
  assert.ok(!JSON.stringify(status).includes(TOKEN));
  const file = path.join(dir, 'github-backup.json');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).token, TOKEN);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal((await backup.configure({ token: '' })).tokenSaved, true, 'an empty token field keeps the saved token');
  assert.deepEqual([(await backup.configure({ clearToken: true })).tokenSaved, (await backup.status()).configured], [false, false]);
  const fromEnv = createGitHubBackup({ env: { TOKSIGHT_CONFIG_DIR: dir, GITHUB_TOKEN: 'env-token' }, home: dir, ghRunner: noGh });
  assert.deepEqual([(await fromEnv.status()).configured, (await fromEnv.status()).tokenSource], [true, 'GITHUB_TOKEN']);
});

test('small snapshots upload through the Contents API and unchanged ones are skipped', async (t) => {
  const { backup, database, github } = await setup(t);
  const uploaded = await backup.upload();
  assert.equal(uploaded.result.unchanged, false);
  assert.ok(github.calls.includes(`PUT /repos/${REPO}/contents/${REMOTE_PATH}`));
  assert.ok(!github.calls.some((call) => call.includes('/git/')), 'no Git Data calls for small files');
  assert.equal(gitBlobSha(github.remote()), uploaded.result.sha);
  assert.deepEqual(Object.keys(uploaded.lastBackup).sort(), ['at', 'branch', 'commit', 'repo', 'sha', 'size']);
  assert.equal(uploaded.lastBackup.size, github.remote().length);
  assert.ok(!JSON.stringify(uploaded).includes(TOKEN));
  github.calls.length = 0;
  const again = await backup.upload();
  assert.equal(again.result.unchanged, true);
  assert.ok(!github.calls.some((call) => call.startsWith('PUT')));
  database.replace(collected([entry(), entry({ sessionId: 'two' })]));
  const next = await backup.upload();
  assert.equal(next.result.unchanged, false, 'an existing file is updated with its sha');
  assert.equal(createUsageDatabase({ file: ':memory:' }).importDatabase(github.remote()).entries, 2);
});

test('large snapshots use the Git Data API; an interrupted upload keeps the old backup and can be retried', async (t) => {
  const many = Array.from({ length: 700 }, (_, i) => entry({ sessionId: `s${i}`, title: `${i} ${'x'.repeat(2000)}` }));
  const { backup, github } = await setup(t, { entries: many, github: fakeGitHub({ empty: true }) });
  github.intercept = (method, route) => method === 'PATCH' && route.includes('/git/refs/') ? json(502, { message: 'Bad gateway' }) : null;
  await rejects(backup.upload(), 'SYNC_GITHUB_ERROR');
  assert.equal(github.remote(), null, 'the ref was never moved');
  assert.equal((await backup.status()).lastBackup, null);
  assert.equal((await backup.status()).busy, null);
  github.intercept = null;
  const done = await backup.upload();
  assert.ok(done.lastBackup.size > 1024 * 1024);
  assert.ok(github.calls.includes(`POST /repos/${REPO}/git/blobs`) && github.calls.includes(`PATCH /repos/${REPO}/git/refs/heads/main`));
  assert.equal(gitBlobSha(github.remote()), done.lastBackup.sha);
  assert.equal(createUsageDatabase({ file: ':memory:' }).importDatabase(github.remote()).entries, 700);
});

test('restore merges a validated download after a safety snapshot', async (t) => {
  const other = await setup(t, { entries: [entry({ sessionId: 'laptop', costUsd: 3 })] });
  await other.backup.upload();
  const { backup, database, dir } = await setup(t, { github: other.github, entries: [entry()] });
  const restored = await backup.restore();
  assert.deepEqual([restored.result.imported, restored.result.entries], [1, 2]);
  assert.equal(database.read().entries.length, 2);
  const safety = path.join(dir, 'backups', 'before-github-restore.sqlite');
  assert.equal(restored.lastRestore.safetyBackup, safety);
  assert.equal(createUsageDatabase({ file: ':memory:' }).importDatabase(readFileSync(safety)).entries, 1, 'the snapshot holds the pre-restore state');
  assert.equal((await backup.restore()).result.duplicates, 1, 'restoring twice is idempotent');
  assert.equal(database.read().entries.length, 2);
});

test('restore refuses missing, corrupt or unmergeable backups without touching local data', async (t) => {
  const { backup, database, github, dir } = await setup(t);
  await rejects(backup.restore(), 'SYNC_NO_BACKUP', (err) => assert.equal(err.status, 404));
  github.put(Buffer.from('SQLite format 3\0 but not really a database'));
  await rejects(backup.restore(), 'SYNC_BAD_BACKUP');
  github.put(Buffer.from('plain text'));
  await rejects(backup.restore(), 'SYNC_BAD_BACKUP');
  // A download that does not match the advertised blob id is rejected.
  github.put(database.exportDatabase());
  github.intercept = (method, route) => route.includes('/git/blobs/') ? new Response(Buffer.from('truncated'), { status: 200 }) : null;
  await rejects(backup.restore(), 'SYNC_BAD_BACKUP');
  github.intercept = null;
  assert.equal(existsSync(path.join(dir, 'backups')), false, 'validation failures happen before the safety snapshot');
  assert.equal(database.read().entries.length, 1);
  await rejects(backup.restore({ importDatabase: () => { throw new Error('disk full'); } }), 'SYNC_MERGE_FAILED', (err) => assert.match(err.message, /rolled back/));
  assert.equal(database.read().entries.length, 1);
  assert.equal((await backup.status()).lastRestore, null);
});

test('GitHub failures map to specific errors and change nothing', async (t) => {
  const cases = [
    [() => json(401, { message: 'Bad credentials' }), 'SYNC_AUTH'],
    [(m, r) => r === `/repos/${REPO}` ? json(404, { message: 'Not Found' }) : null, 'SYNC_REPO_NOT_FOUND'],
    [(m) => m === 'PUT' ? json(403, { message: 'Resource not accessible by personal access token' }) : null, 'SYNC_FORBIDDEN'],
    [(m) => m === 'PUT' ? json(404, { message: 'Not Found' }) : null, 'SYNC_FORBIDDEN'],
    [() => json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793260800' }), 'SYNC_RATE_LIMIT'],
    [() => json(429, { message: 'Too many requests' }, { 'retry-after': '60' }), 'SYNC_RATE_LIMIT'],
    [() => json(503, { message: 'Unavailable' }), 'SYNC_GITHUB_ERROR'],
  ];
  for (const [intercept, code] of cases) {
    const { backup, github, database } = await setup(t);
    github.intercept = intercept;
    await rejects(backup.upload(), code, (err) => {
      if (code === 'SYNC_FORBIDDEN') assert.match(err.message, /Contents: read and write/);
      if (code === 'SYNC_RATE_LIMIT') assert.ok(Number.isFinite(Date.parse(err.retryAt)));
    });
    await rejects(backup.restore(), ['SYNC_FORBIDDEN'].includes(code) ? 'SYNC_NO_BACKUP' : code);
    assert.equal(github.remote(), null);
    assert.equal((await backup.status()).lastBackup, null);
    assert.equal(database.read().entries.length, 1);
  }
  const { backup, github } = await setup(t);
  github.offline = true;
  await rejects(backup.upload(), 'SYNC_OFFLINE');
  await rejects(backup.restore(), 'SYNC_OFFLINE');
});

test('public repositories, oversized snapshots, offline sessions and missing settings are refused before upload', async (t) => {
  const pub = await setup(t, { github: fakeGitHub({ isPrivate: false }) });
  await rejects(pub.backup.upload(), 'SYNC_PUBLIC_REPO', (err) => assert.equal(err.status, 400));
  assert.ok(!pub.github.calls.some((call) => !call.startsWith('GET')), 'nothing is written to a public repository');
  const big = await setup(t);
  const huge = createGitHubBackup({ env: big.env, home: big.dir, ghRunner: noGh, fetchImpl: big.github.fetch, apiBase: API,
    database: { exportDatabase: () => Buffer.alloc(MAX_SNAPSHOT_BYTES + 1) } });
  await rejects(huge.upload(), 'SYNC_TOO_LARGE', (err) => assert.equal(err.status, 413));
  assert.deepEqual(big.github.calls, []);
  const offline = await setup(t, { offline: true });
  await rejects(offline.backup.upload(), 'SYNC_OFFLINE_MODE');
  assert.deepEqual(offline.github.calls, []);
  const blank = await setup(t, { configure: false });
  await rejects(blank.backup.upload(), 'SYNC_NOT_CONFIGURED');
  await rejects(blank.backup.restore(), 'SYNC_NOT_CONFIGURED');
});

test('only one backup or restore runs at a time', async (t) => {
  const { backup, github } = await setup(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetch = github.fetch;
  github.fetch = async (...args) => { await gate; return fetch(...args); };
  const slow = createGitHubBackup({ env: { TOKSIGHT_CONFIG_DIR: path.dirname(backup.file) }, ghRunner: noGh, database: { exportDatabase: () => Buffer.from('x') },
    fetchImpl: (...args) => github.fetch(...args), apiBase: API });
  const first = slow.upload();
  assert.equal((await slow.status()).busy, 'upload');
  await rejects(slow.restore(), 'SYNC_BUSY');
  await assert.rejects(slow.configure({ repo: REPO }), { code: 'SYNC_BUSY' });
  release();
  await first;
  assert.equal((await slow.status()).busy, null);
});

test('web API: loopback-only routes, Origin checks and no token in responses', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-ghsync-web-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const github = fakeGitHub();
  const database = createUsageDatabase({ file: ':memory:' });
  database.completeSetup({ autoUpdate: false });
  const getData = createWebDataService(parseArgs([]), { env: { TOKSIGHT_CONFIG_DIR: dir }, home: dir, database,
    collect: async () => collected([entry()]), genericPricing: async () => ({ records: [], warnings: [], sourceDetails: {} }),
    syncFetch: github.fetch, syncApiBase: API, syncGh: noGh });
  const server = createWebServer({ outDir: dir, getData, port: 0, logger: null });
  const { url } = await server.start();
  t.after(() => server.close());
  const post = (route, body, headers = {}) => fetch(url + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let res = await fetch(`${url}/api/sync/status`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).configured, false);
  res = await fetch(`${url}/api/sync/status?refresh=1`);
  assert.deepEqual((await res.json()).gh, { installed: false, loggedIn: false, user: null, version: null });
  assert.equal((await fetch(`${url}/api/sync/upload`)).status, 405);
  assert.equal((await post('/api/sync/config', { repo: REPO, token: TOKEN }, { origin: 'https://evil.example' })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    const req = http.request(`${url}/api/sync/status`, { headers: { host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(foreignHost, 403, 'a DNS-rebinding Host is refused');
  res = await post('/api/sync/config', { repo: REPO, token: TOKEN }, { origin: url });
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes(TOKEN));
  assert.equal(JSON.parse(text).configured, true);
  res = await post('/api/sync/restore');
  assert.deepEqual([res.status, (await res.json()).code], [404, 'SYNC_NO_BACKUP']);
  res = await post('/api/sync/upload');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).lastBackup.size, github.remote().length);
  github.intercept = () => json(401, { message: 'Bad credentials' });
  res = await post('/api/sync/upload');
  assert.deepEqual([res.status, (await res.json()).code], [502, 'SYNC_AUTH']);
  github.intercept = () => json(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793260800' });
  res = await post('/api/sync/restore');
  const limited = await res.json();
  assert.deepEqual([res.status, limited.code, limited.retryAt], [502, 'SYNC_RATE_LIMIT', '2026-10-29T08:00:00.000Z']);
  github.intercept = null;
  res = await post('/api/sync/restore');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result.duplicates, 1);
  res = await post('/api/sync/config', { repo: 7 });
  assert.deepEqual([res.status, (await res.json()).code], [400, 'SYNC_BAD_REPO']);
});

test('gh detection: missing, logged out, logged in and timed out; results are cached', async () => {
  const missing = await createGhProbe({ run: fakeGh('missing') })();
  assert.deepEqual([missing.installed, missing.loggedIn, missing.token], [false, false, null]);
  const out = await createGhProbe({ run: fakeGh('loggedOut') })();
  assert.deepEqual([out.installed, out.loggedIn, out.version, out.token], [true, false, '2.103.3', null]);
  const hang = await createGhProbe({ run: fakeGh('hang') })();
  assert.deepEqual([hang.installed, hang.loggedIn], [false, false]);
  let time = 0;
  const calls = [];
  const probe = createGhProbe({ run: fakeGh('loggedIn', calls), now: () => time });
  const [a, b] = await Promise.all([probe(), probe()]);
  assert.deepEqual([a.loggedIn, a.user, a.token, a === b], [true, 'octo-cat', GH_TOKEN, true]);
  assert.equal(calls.length, 3, 'concurrent probes share one run');
  time = 59_000; await probe();
  assert.equal(calls.length, 3, 'cached for a minute');
  await probe({ force: true });
  assert.equal(calls.length, 6, 'forced re-check');
  time = 200_000; await probe();
  assert.equal(calls.length, 9, 'expired cache re-checks');
  // The real runner skips a missing binary instead of throwing up the stack.
  const real = await createGhProbe({ run: createGhRunner({ bin: 'toksight-no-such-gh-binary', timeout: 2000 }) })();
  assert.deepEqual([real.installed, real.loggedIn], [false, false]);
});

test('gh token precedence: env beats gh, gh beats the saved token, and it never leaks', async (t) => {
  const { backup, dir } = await setup(t, { ghRunner: fakeGh('loggedIn') });
  let status = await backup.status();
  assert.deepEqual([status.tokenSource, status.tokenSaved, status.configured], ['gh', true, true]);
  assert.deepEqual(status.gh, { installed: true, loggedIn: true, user: 'octo-cat', version: '2.103.3' });
  assert.ok(!JSON.stringify(status).includes(GH_TOKEN) && !JSON.stringify(status).includes(TOKEN));
  assert.ok(!readFileSync(path.join(dir, 'github-backup.json'), 'utf8').includes(GH_TOKEN), 'the gh token is never persisted');
  const env = await setup(t, { ghRunner: fakeGh('loggedIn'), env: { GITHUB_TOKEN: 'env-token-123' } });
  status = await env.backup.status();
  assert.deepEqual([status.tokenSource, status.gh.loggedIn], ['GITHUB_TOKEN', true]);
  const out = await setup(t, { ghRunner: fakeGh('loggedOut') });
  assert.equal((await out.backup.status()).tokenSource, 'config', 'a logged-out gh falls through to the saved token');
  const none = await setup(t, { ghRunner: fakeGh('missing'), configure: false });
  await none.backup.configure({ repo: REPO });
  assert.deepEqual([(await none.backup.status()).configured, (await none.backup.status()).gh.installed], [false, false]);
  await rejects(none.backup.upload(), 'SYNC_NOT_CONFIGURED');
});

test('upload and restore re-check gh and send its token', async (t) => {
  let state = 'loggedIn';
  const ghCalls = [];
  const runner = (args) => fakeGh(state, ghCalls)(args);
  const github = fakeGitHub();
  const auth = [];
  const fetch = github.fetch;
  github.fetch = (url, init) => { auth.push(init.headers.authorization); return fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${TOKEN}` } }); };
  const { backup } = await setup(t, { github, ghRunner: runner, configure: false });
  await backup.configure({ repo: REPO });
  await backup.status();
  const statusCalls = ghCalls.length;
  await backup.upload();
  assert.ok(ghCalls.length > statusCalls, 'upload forces a fresh gh check');
  assert.ok(auth.length && auth.every((value) => value === `Bearer ${GH_TOKEN}`));
  state = 'loggedOut';
  await rejects(backup.restore(), 'SYNC_NOT_CONFIGURED', (err) => assert.ok(!err.message.includes(GH_TOKEN)));
});
