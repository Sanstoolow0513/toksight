import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createWebServer, isLoopbackAddress } from '../src/webserver.js';

const payload = { tool: 'toksight', totals: { totalTokens: 42 }, warnings: [] };

test('configuration endpoint loopback check accepts only local addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.99.8.7'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.example.test'), false);
  assert.equal(isLoopbackAddress('192.168.1.10'), false);
  assert.equal(isLoopbackAddress('::ffff:192.168.1.10'), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

async function withServer(opts, fn) {
  // port 0 → ephemeral, so each test server is a distinct origin (undici's
  // keep-alive pool would otherwise reuse sockets across same-port servers).
  const server = createWebServer({ outDir: os.tmpdir(), getData: async () => payload, port: 0, ...opts });
  const { url } = await server.start();
  try {
    return await fn(url);
  } finally {
    await server.close();
  }
}

test('/api/data serves fresh JSON with no-store and no CORS', async () => {
  let calls = 0;
  await withServer(
    {
      getData: async () => {
        calls += 1;
        return { ...payload, calls };
      },
    },
    async (url) => {
      const res = await fetch(`${url}/api/data`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /application\/json/);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      // Same-origin API: no wildcard CORS, so other websites can't read local
      // session data from the browser.
      assert.equal(res.headers.get('access-control-allow-origin'), null);
      assert.deepEqual(await res.json(), { ...payload, calls: 1 });
      const second = await fetch(`${url}/api/data`);
      assert.deepEqual(await second.json(), { ...payload, calls: 2 }); // re-collected per request
    },
  );
});

test('serves the prebuilt dashboard from outDir and 404s missing assets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-web-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>toksight dashboard</html>');
  fs.writeFileSync(path.join(dir, 'config.html'), '<html>agent configuration</html>');
  fs.mkdirSync(path.join(dir, '_next', 'static'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_next', 'static', 'app.js'), 'console.log(1)');

  await withServer({ outDir: dir }, async (url) => {
    const home = await fetch(`${url}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.equal(await home.text(), '<html>toksight dashboard</html>');

    const config = await fetch(`${url}/config`);
    assert.equal(config.status, 200);
    assert.match(config.headers.get('content-type'), /text\/html/);
    assert.equal(await config.text(), '<html>agent configuration</html>');

    const asset = await fetch(`${url}/_next/static/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'console.log(1)');

    const missing = await fetch(`${url}/nope.css`);
    assert.equal(missing.status, 404);
  });
});

test('configuration API supports inventory, export preview and selective import', async () => {
  const calls = [];
  const configService = {
    async inspect() {
      calls.push(['inspect']);
      return { agents: [{ id: 'codex', items: [] }], warnings: [] };
    },
    async exportBundle(items) {
      calls.push(['export', items]);
      return { format: 'toksight-agent-config', version: 1, createdAt: '2026-09-02T12:30:00.000Z', items: [] };
    },
    async previewBundle(bundle) {
      calls.push(['preview', bundle]);
      return { format: bundle.format, items: [{ id: 'codex.config', redacted: true }] };
    },
    async importBundle(bundle, items) {
      calls.push(['import', bundle, items]);
      return { imported: items.map((id) => ({ id })), backups: [] };
    },
  };

  await withServer({ configService }, async (url) => {
    const inventory = await fetch(`${url}/api/config`);
    assert.equal(inventory.status, 200);
    assert.equal(inventory.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await inventory.json(), { agents: [{ id: 'codex', items: [] }], warnings: [] });

    const exported = await fetch(`${url}/api/config/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: ['codex.config'] }),
    });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition'), /\.toksight-config\.json/);
    const bundle = await exported.json();

    const previewed = await fetch(`${url}/api/config/import/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ bundle }),
    });
    assert.deepEqual(await previewed.json(), {
      format: 'toksight-agent-config',
      items: [{ id: 'codex.config', redacted: true }],
    });

    const imported = await fetch(`${url}/api/config/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bundle, items: ['codex.config'] }),
    });
    assert.deepEqual(await imported.json(), { imported: [{ id: 'codex.config' }], backups: [] });
  });

  assert.deepEqual(calls, [
    ['inspect'],
    ['export', ['codex.config']],
    ['preview', { format: 'toksight-agent-config', version: 1, createdAt: '2026-09-02T12:30:00.000Z', items: [] }],
    ['import', { format: 'toksight-agent-config', version: 1, createdAt: '2026-09-02T12:30:00.000Z', items: [] }, ['codex.config']],
  ]);
});

test('configuration writes require JSON and return structured service errors', async () => {
  const configService = {
    inspect: async () => ({ agents: [], warnings: [] }),
    exportBundle: async () => {
      throw Object.assign(new Error('bad selection'), { status: 400, code: 'INVALID_SELECTION' });
    },
  };
  await withServer({ configService }, async (url) => {
    const wrongType = await fetch(`${url}/api/config/export`, { method: 'POST', body: '{}' });
    assert.equal(wrongType.status, 415);
    assert.equal((await wrongType.json()).code, 'UNSUPPORTED_MEDIA_TYPE');

    const almostJson = await fetch(`${url}/api/config/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/jsonp' },
      body: '{}',
    });
    assert.equal(almostJson.status, 415);

    const tooLarge = await fetch(`${url}/api/config/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(12 * 1024 * 1024 + 1),
    });
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).code, 'BODY_TOO_LARGE');

    const invalid = await fetch(`${url}/api/config/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'INVALID_JSON');

    const serviceError = await fetch(`${url}/api/config/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"items":[]}',
    });
    assert.equal(serviceError.status, 400);
    assert.deepEqual(await serviceError.json(), { error: 'bad selection', code: 'INVALID_SELECTION' });
  });
});

test('HEAD requests get headers only, without a response body', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-web-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>head-body-marker</html>');

  // Raw socket, not fetch: fetch always reports an empty body for HEAD, so it
  // can't tell whether bytes actually went over the wire.
  await withServer({ outDir: dir }, async (url) => {
    const { port } = new URL(url);
    await new Promise((resolve, reject) => {
      const sock = net.connect(Number(port), '127.0.0.1');
      let raw = '';
      sock.on('error', reject);
      sock.on('connect', () => sock.write('HEAD / HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n'));
      sock.on('data', (d) => {
        raw += d.toString('latin1');
      });
      sock.on('close', () => {
        assert.ok(raw.startsWith('HTTP/1.1 200'), `unexpected status line: ${raw.split('\r\n')[0]}`);
        assert.ok(!raw.includes('head-body-marker'), 'HEAD response must not carry a body');
        resolve();
      });
    });
  });
});

test('blocks path traversal outside outDir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-web-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>ok</html>');
  const secret = path.join(os.tmpdir(), `toksight-secret-${Date.now()}.json`);
  fs.writeFileSync(secret, '{"secret":true}');

  await withServer({ outDir: dir }, async (url) => {
    const res = await fetch(`${url}/..%2f..%2f${path.basename(secret)}`);
    assert.equal(res.status, 403);
  });
  fs.unlinkSync(secret);
});

test('serves setup instructions when the dashboard is not built yet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-web-empty-'));
  await withServer({ outDir: dir }, async (url) => {
    const res = await fetch(`${url}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /npm run web:build/);
    // The API keeps working without the static dashboard.
    const api = await fetch(`${url}/api/data`);
    assert.equal(api.status, 200);
  });
});

test('api-only mode serves the API but not pages', async () => {
  await withServer({ apiOnly: true }, async (url) => {
    const api = await fetch(`${url}/api/data`);
    assert.equal(api.status, 200);
    const page = await fetch(`${url}/`);
    assert.equal(page.status, 404);
  });
});

test('getData failures surface as 500 JSON errors', async () => {
  await withServer(
    {
      getData: async () => {
        throw new Error('boom');
      },
    },
    async (url) => {
      const res = await fetch(`${url}/api/data`);
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.match(String(body.error), /boom/);
    },
  );
});

test('start() rejects with a friendly error when the port is taken', async () => {
  await withServer({}, async (url) => {
    const port = Number(new URL(url).port);
    const second = createWebServer({ port, outDir: os.tmpdir(), getData: async () => payload });
    await assert.rejects(() => second.start(), /already in use/);
  });
});
