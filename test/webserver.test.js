import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createWebServer, isLocalHostHeader, isLoopbackAddress } from '../src/webserver.js';

const payload = { tool: 'toksight', totals: { totalTokens: 42 }, warnings: [] };

test('loopback check accepts only local addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.99.8.7'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.example.test'), false);
  assert.equal(isLoopbackAddress('192.168.1.10'), false);
  assert.equal(isLoopbackAddress('::ffff:192.168.1.10'), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

test('Host header check accepts only localhost names with or without a port', () => {
  assert.equal(isLocalHostHeader('localhost'), true);
  assert.equal(isLocalHostHeader('localhost:4729'), true);
  assert.equal(isLocalHostHeader('127.0.0.1'), true);
  assert.equal(isLocalHostHeader('127.0.0.1:4729'), true);
  assert.equal(isLocalHostHeader('LOCALHOST:4729'), true);
  assert.equal(isLocalHostHeader('[::1]:4729'), true);
  assert.equal(isLocalHostHeader('[::1]'), true);
  assert.equal(isLocalHostHeader('[::ffff:127.0.0.1]:4729'), true);
  // A rebinder's domain — resolves to 127.0.0.1 but is not a localhost name.
  assert.equal(isLocalHostHeader('evil.example'), false);
  assert.equal(isLocalHostHeader('evil.example:4729'), false);
  assert.equal(isLocalHostHeader('192.168.1.10:4729'), false);
  assert.equal(isLocalHostHeader('localhost.evil.example'), false);
  assert.equal(isLocalHostHeader('::1'), true); // bare IPv6, several colons, no port
  assert.equal(isLocalHostHeader(undefined), false);
  assert.equal(isLocalHostHeader(''), false);
  assert.equal(isLocalHostHeader('[::1'), false); // unterminated bracket
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

test('/api/data is read-only and other /api paths are JSON 404s', async () => {
  await withServer({}, async (url) => {
    const posted = await fetch(`${url}/api/data`, { method: 'POST', body: '{}' });
    assert.equal(posted.status, 405);
    assert.equal(posted.headers.get('allow'), 'GET, HEAD');
    assert.equal((await posted.json()).code, 'METHOD_NOT_ALLOWED');

    for (const route of ['/api/config', '/api/config/import', '/api/nope']) {
      const res = await fetch(url + route);
      assert.equal(res.status, 404, route);
      assert.match(res.headers.get('content-type'), /application\/json/);
      assert.equal((await res.json()).code, 'NOT_FOUND');
    }
  });
});

test('serves the prebuilt dashboard from outDir and 404s missing assets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-web-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>toksight dashboard</html>');
  fs.writeFileSync(path.join(dir, 'report.html'), '<html>exported route</html>');
  fs.mkdirSync(path.join(dir, '_next', 'static'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_next', 'static', 'app.js'), 'console.log(1)');

  await withServer({ outDir: dir }, async (url) => {
    const home = await fetch(`${url}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.equal(home.headers.get('cache-control'), 'no-cache');
    assert.equal(await home.text(), '<html>toksight dashboard</html>');

    // Next's static export writes app/<route>/page.js as <route>.html.
    const route = await fetch(`${url}/report`);
    assert.equal(route.status, 200);
    assert.equal(await route.text(), '<html>exported route</html>');

    const asset = await fetch(`${url}/_next/static/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    assert.equal(await asset.text(), 'console.log(1)');

    const missing = await fetch(`${url}/nope.css`);
    assert.equal(missing.status, 404);
  });
});

// Raw socket, not fetch: fetch always sends the real origin as Host, so a
// forged Host header (what a DNS-rebinding page produces) needs hand-written
// requests. Returns the raw response bytes.
function rawRequest(port, request) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let raw = '';
    sock.on('error', reject);
    sock.on('connect', () => sock.write(request));
    sock.on('data', (d) => {
      raw += d.toString('latin1');
    });
    sock.on('close', () => resolve(raw));
    sock.setTimeout(5000, () => sock.destroy(new Error('raw request timed out')));
  });
}

const rawGet = (route, host) => `GET ${route} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;

test('/api/data rejects a forged Host header (DNS rebinding)', async () => {
  await withServer({}, async (url) => {
    const port = Number(new URL(url).port);

    // A rebinding page: remoteAddress is 127.0.0.1, but the Host the browser
    // was tricked into requesting is the attacker's domain.
    const forged = await rawRequest(port, rawGet('/api/data', 'evil.example'));
    assert.ok(forged.startsWith('HTTP/1.1 403'), `foreign Host must 403, got: ${forged.split('\r\n')[0]}`);
    assert.match(forged, /HOST_NOT_ALLOWED/);

    // Localhost Hosts keep working, port or not.
    for (const host of ['127.0.0.1', `localhost:${port}`]) {
      const raw = await rawRequest(port, rawGet('/api/data', host));
      assert.ok(raw.startsWith('HTTP/1.1 200'), `Host ${host} must 200, got: ${raw.split('\r\n')[0]}`);
    }
  });
});

test('a deliberately exposed server keeps serving /api/data to foreign Hosts', async () => {
  // --host 0.0.0.0 is an explicit opt-in to serve the LAN; the Host check
  // would only break that.
  await withServer({ host: '0.0.0.0' }, async (url) => {
    const port = Number(new URL(url).port);
    const data = await rawRequest(port, rawGet('/api/data', 'server.lan.example'));
    assert.ok(data.startsWith('HTTP/1.1 200'), `exposed /api/data must serve, got: ${data.split('\r\n')[0]}`);
  });
});

test('HEAD requests get headers only, without a response body', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toksight-web-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>head-body-marker</html>');

  // Raw socket, not fetch: fetch always reports an empty body for HEAD, so it
  // can't tell whether bytes actually went over the wire.
  await withServer({ outDir: dir }, async (url) => {
    const raw = await rawRequest(Number(new URL(url).port), 'HEAD / HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n');
    assert.ok(raw.startsWith('HTTP/1.1 200'), `unexpected status line: ${raw.split('\r\n')[0]}`);
    assert.ok(!raw.includes('head-body-marker'), 'HEAD response must not carry a body');
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
