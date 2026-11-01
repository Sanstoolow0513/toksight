import assert from 'node:assert/strict';
import test from 'node:test';
import { apiFetch, installDesktopLinks, isDesktop, saveFile } from '../frontend/lib/desktop.js';

function native(t, handler) {
  const original = globalThis.window;
  globalThis.window = { __TAURI__: { core: { invoke: handler } }, location: new URL('http://tauri.localhost/') };
  t.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });
}

const reply = (body = '{}', status = 200, headers = { 'content-type': 'application/json' }) => ({
  status, headers, bodyBase64: Buffer.from(body).toString('base64'),
});

test('desktop transport leaves normal browser requests untouched', async (t) => {
  const response = Response.json({ browser: true });
  const options = { method: 'POST', body: 'data', signal: new AbortController().signal };
  const fetch = t.mock.method(globalThis, 'fetch', async (path, init) => {
    assert.equal(path, '/api/refresh');
    assert.equal(init, options);
    return response;
  });
  assert.equal(isDesktop(), false);
  assert.equal(await apiFetch('/api/refresh', options), response);
  assert.equal(fetch.mock.callCount(), 1);
});

test('desktop transport carries JSON and binary payloads without putting credentials in the page', async (t) => {
  const bytes = Buffer.alloc(98_321);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  let request;
  native(t, async (command, args) => {
    assert.equal(command, 'desktop_request');
    request = args;
    return reply(bytes, 200, { 'content-type': 'application/vnd.sqlite3' });
  });
  const res = await apiFetch('/api/import/db', { method: 'POST', body: new Blob([bytes]),
    headers: { 'content-type': 'application/vnd.sqlite3', 'x-arbitrary-header': 'not-forwarded' } });
  assert.deepEqual(Buffer.from(request.bodyBase64, 'base64'), bytes);
  assert.deepEqual(Object.keys(request).sort(), ['bodyBase64', 'contentType', 'method', 'path']);
  assert.equal(request.contentType, 'application/vnd.sqlite3');
  assert.equal(res.headers.get('content-type'), 'application/vnd.sqlite3');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);

  await apiFetch('/api/setup', { method: 'POST', body: JSON.stringify({ label: '中文 🌅' }), headers: { 'content-type': 'application/json' } });
  assert.deepEqual(JSON.parse(Buffer.from(request.bodyBase64, 'base64').toString()), { label: '中文 🌅' });
});

test('desktop errors preserve HTTP status and rejected IPC errors become Error objects', async (t) => {
  native(t, async () => reply('{"code":"BAD_DATABASE"}', 400));
  const res = await apiFetch('/api/import/db', { method: 'POST' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'BAD_DATABASE');
  window.__TAURI__.core.invoke = async () => { throw 'Desktop service stopped'; };
  await assert.rejects(apiFetch('/api/data'), /Desktop service stopped/);
});

test('aborted desktop reads never resolve stale results or submit pre-aborted requests', async (t) => {
  let complete;
  let requests = 0;
  native(t, () => { requests++; return new Promise((resolve) => { complete = resolve; }); });
  const controller = new AbortController();
  const response = apiFetch('/api/data?timezone=UTC', { signal: controller.signal });
  controller.abort();
  await assert.rejects(response, { name: 'AbortError' });
  complete(reply('{"stale":true}'));
  await assert.rejects(apiFetch('/api/data', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('desktop frontend rejects non-API requests and unsupported methods before IPC', async (t) => {
  native(t, async () => assert.fail('invalid requests must never reach IPC'));
  for (const path of ['https://example.com/api/data', '//example.com/api/data', '/api/data#fragment', '/api\\data']) {
    await assert.rejects(apiFetch(path), /local \/api\//);
  }
  await assert.rejects(apiFetch('/api/data', { method: 'DELETE' }), /Unsupported/);
});

test('native file exports preserve bytes and distinguish cancelling from saving', async (t) => {
  const calls = [];
  native(t, async (command, args) => { calls.push({ command, args }); return calls.length !== 1; });
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(await saveFile('calendar.png', png), false);
  assert.deepEqual(calls[0], { command: 'desktop_save', args: { filename: 'calendar.png', bodyBase64: 'iVBORw0KGgo=' } });
  const data = new Blob([Buffer.from('SQLite format 3\0')]);
  assert.equal(await saveFile('backup.sqlite', data), true);
  assert.equal(Buffer.from(calls[1].args.bodyBase64, 'base64').toString(), 'SQLite format 3\0');
  await assert.rejects(saveFile('report.png', 'https://example.com/image.png'), /PNG data URL/);
});

test('desktop links keep hash navigation local and open external links outside the app', async (t) => {
  const calls = [], listeners = new Map();
  native(t, async (command, args) => { calls.push({ command, args }); });
  const original = globalThis.document;
  globalThis.document = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => { assert.equal(listeners.get(name), handler); listeners.delete(name); },
  };
  t.after(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
  const cleanup = installDesktopLinks((error) => assert.fail(error));
  const click = (href, type = 'click', button = 0) => {
    let prevented = false;
    listeners.get(type)({ type, button, target: { closest: () => ({ href, hasAttribute: () => false }) },
      preventDefault: () => { prevented = true; } });
    return prevented;
  };
  assert.equal(click('http://tauri.localhost/#main-content'), false);
  assert.equal(click('https://github.com/Sanstoolow0513/toksight'), true);
  assert.equal(click('https://example.com/prices', 'auxclick', 1), true);
  assert.equal(click('https://example.com/prices', 'auxclick', 2), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { command: 'desktop_open_url', args: { url: 'https://github.com/Sanstoolow0513/toksight' } });
  cleanup();
  assert.equal(listeners.size, 0);
});
