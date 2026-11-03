import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebServer } from '../src/webserver.js';

const serviceFile = fileURLToPath(new URL('../desktop/service.mjs', import.meta.url));
const HEADER = 'X-Toksight-Desktop-Token';
const fixtureRow = (id, inputTokens) => JSON.stringify({ type: 'assistant', sessionId: 'desktop-fixture',
  timestamp: '2026-08-29T10:00:00.000Z', message: { id, model: 'claude-sonnet-4-5',
    usage: { input_tokens: inputTokens, output_tokens: 20, cache_read_input_tokens: 5 } } }) + '\n';

async function deadline(promise, milliseconds = 10_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('desktop child timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function launch(t, { start = true, configIsFile = false } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'toksight-desktop-test-'));
  const home = path.join(temporary, 'home');
  const configDir = path.join(temporary, 'config');
  const fixture = path.join(home, '.claude', 'projects', 'fixture', 'session.jsonl');
  await mkdir(path.dirname(fixture), { recursive: true });
  await writeFile(fixture, fixtureRow('first', 100));
  if (configIsFile) await writeFile(configDir, 'not a directory');
  // Deliberately do not inherit Agent roots, tokens, NODE_OPTIONS or XDG paths.
  // Every collector uses the temporary home, never the developer's sessions.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['systemroot', 'windir', 'path', 'temp', 'tmp'].includes(key.toLowerCase())));
  const child = spawn(process.execPath, [serviceFile], { cwd: temporary, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const token = randomBytes(32).toString('hex');
  let output = '', errors = '';
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Invalid-handshake tests intentionally never await ready.
  ready.catch(() => {});
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (output.includes('\n')) {
      try { resolveReady(JSON.parse(output.slice(0, output.indexOf('\n')))); }
      catch (error) { rejectReady(error); }
    }
  });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.on('error', (error) => { rejectReady(error); reject(error); });
    child.on('close', (code, signal) => {
      rejectReady(new Error(`desktop service exited before ready (${code}): ${errors}`));
      resolve({ code, signal });
    });
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await deadline(closed).catch(() => { child.kill('SIGKILL'); });
    // mkdtemp owns exactly this subtree; validate before recursive cleanup.
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  });
  const handshake = { token, offline: true, home, configDir };
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  if (start) send(handshake);
  return { child, ready, closed, token, fixture, configDir, home, handshake, send,
    stdout: () => output, stderr: () => errors };
}

test('desktop sidecar authenticates every route and refreshes only its own offline snapshot', { timeout: 20_000 }, async (t) => {
  const app = await launch(t);
  const ready = await deadline(app.ready);
  assert.deepEqual(Object.keys(ready).sort(), ['type', 'url']);
  assert.equal(ready.type, 'ready');
  const address = new URL(ready.url);
  assert.equal(address.hostname, '127.0.0.1');
  assert.ok(Number(address.port) > 0);
  const headers = { [HEADER]: app.token };

  for (const route of ['/', '/api/data', '/api/refresh', '/api/export/db', '/api/no-such-route']) {
    for (const token of [undefined, 'bad', '0'.repeat(64)]) {
      const response = await fetch(ready.url + route, { headers: token ? { [HEADER]: token } : {},
        method: route === '/api/refresh' ? 'POST' : 'GET' });
      assert.equal(response.status, 401, route);
      assert.equal((await response.json()).code, 'DESKTOP_UNAUTHORIZED');
    }
  }
  assert.equal((await fetch(ready.url + '/', { headers })).status, 404);
  const read = async () => (await fetch(ready.url + '/api/data', { headers })).json();
  const initial = await read();
  assert.equal(initial.totals.requests, 1);
  assert.equal(initial.totals.inputTokens, 100);
  assert.equal(initial.priceDatabase.offline, true);
  const originalFixture = await readFile(app.fixture, 'utf8');
  await appendFile(app.fixture, fixtureRow('second', 70));
  assert.equal((await read()).totals.requests, 1, 'GET must not recollect Agent files');
  const refresh = await fetch(ready.url + '/api/refresh', { method: 'POST', headers });
  assert.equal(refresh.status, 200);
  assert.equal((await refresh.json()).entries, 2);
  assert.equal((await read()).totals.inputTokens, 170);
  assert.equal(await readFile(app.fixture, 'utf8'), originalFixture + fixtureRow('second', 70), 'Agent files remain unchanged');
  const forbiddenOrigin = await fetch(ready.url + '/api/refresh', { method: 'POST', headers: { ...headers, Origin: 'https://example.invalid' } });
  assert.equal(forbiddenOrigin.status, 403);
  const offline = await fetch(ready.url + '/api/prices/update', { method: 'POST', headers });
  assert.equal((await offline.json()).code, 'PRICE_OFFLINE');
  app.send({ type: 'shutdown' });
  assert.equal((await deadline(app.closed)).code, 0);
  assert.equal(app.stdout().trim().split('\n').length, 1);
  assert.ok(!app.stdout().includes(app.token));
  assert.ok(!app.stderr().includes(app.token));
  assert.equal((await readFile(path.join(app.configDir, 'usage.sqlite'))).subarray(0, 15).toString(), 'SQLite format 3');
});

test('parallel desktop hosts receive distinct ports and stdin EOF shuts down the owned service', { timeout: 20_000 }, async (t) => {
  const first = await launch(t);
  const second = await launch(t);
  const [a, b] = await deadline(Promise.all([first.ready, second.ready]));
  assert.notEqual(a.url, b.url);
  const wrongHostToken = await fetch(a.url + '/api/data', { headers: { [HEADER]: second.token } });
  assert.equal(wrongHostToken.status, 401);
  first.child.stdin.end();
  second.child.stdin.end();
  assert.deepEqual((await deadline(Promise.all([first.closed, second.closed]))).map((result) => result.code), [0, 0]);
});

test('desktop initialization accepts a fragmented JSON line and closes during startup without advertising ready', { timeout: 15_000 }, async (t) => {
  const app = await launch(t, { start: false });
  const line = JSON.stringify(app.handshake);
  app.child.stdin.write(line.slice(0, 15));
  app.child.stdin.write(line.slice(15) + '\n' + JSON.stringify({ type: 'shutdown' }) + '\n');
  assert.equal((await deadline(app.closed)).code, 0);
  assert.equal(app.stdout(), '');
});

test('desktop startup errors are structured on stderr and never publish ready or the secret', { timeout: 15_000 }, async (t) => {
  const app = await launch(t, { configIsFile: true });
  assert.equal((await deadline(app.closed)).code, 1);
  assert.equal(app.stdout(), '');
  const errors = app.stderr().split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  assert.ok(errors.some((error) => error.type === 'error' && error.code === 'DESKTOP_START_FAILED'));
  assert.ok(!app.stderr().includes(app.token));
});

test('invalid and oversized handshakes fail before starting or collecting', { timeout: 15_000 }, async (t) => {
  for (const line of [JSON.stringify({ token: 'not-a-secret', offline: true }), 'x'.repeat(16 * 1024 + 1)]) {
    const app = await launch(t, { start: false });
    app.child.stdin.write(line + '\n');
    assert.equal((await deadline(app.closed)).code, 1);
    assert.equal(app.stdout(), '');
    assert.match(app.stderr(), /DESKTOP_BAD_(HANDSHAKE|PROTOCOL)/);
    await assert.rejects(readFile(path.join(app.configDir, 'usage.sqlite')), { code: 'ENOENT' });
  }
});

test('desktop shutdown has a deadline even when a client stalls an authenticated upload', { timeout: 15_000 }, async (t) => {
  const app = await launch(t);
  const ready = await deadline(app.ready);
  const socket = net.connect(Number(new URL(ready.url).port), '127.0.0.1');
  t.after(() => socket.destroy());
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  socket.on('error', () => {});
  socket.write(`POST /api/import/db HTTP/1.1\r\nHost: 127.0.0.1\r\n${HEADER}: ${app.token}\r\nContent-Length: 100\r\n\r\nx`);
  app.send({ type: 'shutdown' });
  assert.equal((await deadline(app.closed, 8000)).code, 1);
  assert.match(app.stderr(), /DESKTOP_SHUTDOWN_TIMEOUT/);
});

test('desktop auth is opt-in and an invalid configured secret fails closed', async () => {
  assert.throws(() => createWebServer({ apiOnly: true, desktopToken: '' }), /desktopToken/);
  const server = createWebServer({ apiOnly: true, port: 0, getData: async () => ({ browserMode: true }) });
  const { url } = await server.start();
  try { assert.deepEqual(await (await fetch(url + '/api/data')).json(), { browserMode: true }); }
  finally { await server.close(); }
});
