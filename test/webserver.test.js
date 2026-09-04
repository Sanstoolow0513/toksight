import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createWebServer, isLocalHostHeader, isLoopbackAddress } from '../src/webserver.js';

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

test('configuration inventory is a read-only loopback endpoint', async () => {
  const calls = [];
  const configService = {
    async inspect() {
      calls.push(['inspect']);
      return { agents: [{ id: 'codex', files: [], summary: {} }], warnings: [] };
    },
  };

  await withServer({ configService }, async (url) => {
    const inventory = await fetch(`${url}/api/config`);
    assert.equal(inventory.status, 200);
    assert.equal(inventory.headers.get('access-control-allow-origin'), null);
    assert.equal(inventory.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await inventory.json(), { agents: [{ id: 'codex', files: [], summary: {} }], warnings: [] });

    // The inventory itself never accepts a body: POST is a 405 no matter
    // what transfer services exist.
    const posted = await fetch(`${url}/api/config`, { method: 'POST', body: '{}' });
    assert.equal(posted.status, 405);
    assert.equal((await posted.json()).code, 'METHOD_NOT_ALLOWED');

    // Unknown sub-paths stay 404 (no transfer service registered here).
    const stray = await fetch(`${url}/api/config/nope`);
    assert.equal(stray.status, 404);
  });

  assert.deepEqual(calls, [['inspect']]);
});

test('transfer endpoints exist and are gated on their service', async () => {
  const configService = { async inspect() { return { agents: [], warnings: [] }; } };

  await withServer({ configService }, async (url) => {
    const exported = await fetch(`${url}/api/config/export`);
    assert.equal(exported.status, 503);
    assert.equal((await exported.json()).code, 'TRANSFER_UNAVAILABLE');

    const preview = await fetch(`${url}/api/config/import/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-toksight-action': 'import-preview' },
      body: JSON.stringify({ bundle: { format: 'x' } }),
    });
    assert.equal(preview.status, 503);
    assert.equal((await preview.json()).code, 'TRANSFER_UNAVAILABLE');

    const imported = await fetch(`${url}/api/config/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-toksight-action': 'import' },
      body: JSON.stringify({ bundle: { format: 'x' } }),
    });
    assert.equal(imported.status, 503);
    assert.equal((await imported.json()).code, 'TRANSFER_UNAVAILABLE');
  });
});

test('export endpoint streams the bundle with a download disposition', async () => {
  const configService = { async inspect() { return { agents: [], warnings: [] }; } };
  const calls = [];
  const transferService = {
    async exportBundle(opts) {
      calls.push(opts);
      return {
        bundle: { format: 'toksight-agent-config-bundle', version: 1, files: [{ id: 'claude.settings' }] },
        warnings: ['big file skipped'],
      };
    },
  };

  await withServer({ configService, transferService }, async (url) => {
    const res = await fetch(`${url}/api/config/export?agents=claude&files=claude.settings`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="toksight-agent-configs\.json"/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.format, 'toksight-agent-config-bundle');
    assert.deepEqual(body.files, [{ id: 'claude.settings' }]);
    assert.deepEqual(body.warnings, ['big file skipped']);
  });

  assert.deepEqual(calls, [{ agents: 'claude', files: 'claude.settings' }]);
});

test('import endpoints enforce method, content-type and action header', async () => {
  const configService = { async inspect() { return { agents: [], warnings: [] }; } };
  const transferService = {
    async planImport() { return { error: null, plan: [], warnings: [] }; },
    async applyImport() { return { error: null, results: [], warnings: [] }; },
  };
  const calls = [];
  const recording = {
    ...transferService,
    async planImport(bundle, opts) { calls.push(['plan', bundle, opts]); return transferService.planImport(bundle, opts); },
    async applyImport(bundle, opts) { calls.push(['apply', bundle, opts]); return transferService.applyImport(bundle, opts); },
  };

  await withServer({ configService, transferService: recording }, async (url) => {
    // GET is not a thing on the import endpoints.
    const got = await fetch(`${url}/api/config/import`);
    assert.equal(got.status, 405);
    assert.equal((await got.json()).code, 'METHOD_NOT_ALLOWED');

    // text/plain (the no-preflight CSRF shape) is rejected before the body
    // is even read, and never reaches the service.
    const plain = await fetch(`${url}/api/config/import`, { method: 'POST', body: '{}' });
    assert.equal(plain.status, 415);
    assert.equal((await plain.json()).code, 'UNSUPPORTED_MEDIA_TYPE');

    // JSON content type without the action header is rejected too.
    const noHeader = await fetch(`${url}/api/config/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bundle: {} }),
    });
    assert.equal(noHeader.status, 403);
    assert.equal((await noHeader.json()).code, 'ACTION_HEADER_REQUIRED');

    // Wrong action value for the endpoint.
    const wrongAction = await fetch(`${url}/api/config/import/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-toksight-action': 'import' },
      body: JSON.stringify({ bundle: {} }),
    });
    assert.equal(wrongAction.status, 403);
    assert.equal((await wrongAction.json()).code, 'ACTION_HEADER_REQUIRED');

    // Not JSON at all.
    const badJson = await fetch(`${url}/api/config/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-toksight-action': 'import' },
      body: 'not json',
    });
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).code, 'BAD_JSON');

    // Malformed request body shape (bundle must be an object).
    const badShape = await fetch(`${url}/api/config/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-toksight-action': 'import' },
      body: JSON.stringify({ bundle: 'nope' }),
    });
    assert.equal(badShape.status, 400);
    assert.equal((await badShape.json()).code, 'BAD_REQUEST');

    // selected must be an array of strings.
    const badSelected = await fetch(`${url}/api/config/import/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-toksight-action': 'import-preview' },
      body: JSON.stringify({ bundle: { format: 'toksight-agent-config-bundle', version: 1, files: [] }, selected: 42 }),
    });
    assert.equal(badSelected.status, 400);
    assert.equal((await badSelected.json()).code, 'BAD_REQUEST');

    // A well-formed request reaches the service with bundle + selected.
    const bundle = { format: 'toksight-agent-config-bundle', version: 1, files: [] };
    const ok = await fetch(`${url}/api/config/import/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-toksight-action': 'import-preview' },
      body: JSON.stringify({ bundle, selected: ['claude.settings'] }),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { error: null, plan: [], warnings: [] });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'plan');
  assert.deepEqual(calls[0][1], { format: 'toksight-agent-config-bundle', version: 1, files: [] });
  assert.deepEqual(calls[0][2], { selected: ['claude.settings'] });
});

test('cross-site browser requests to the config API are rejected', async () => {
  const configService = { async inspect() { return { agents: [], warnings: [] }; } };

  await withServer({ configService }, async (url) => {
    const crossSite = await fetch(`${url}/api/config`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossSite.status, 403);
    assert.equal((await crossSite.json()).code, 'CROSS_SITE_NOT_ALLOWED');

    // same-origin and none pass; absence (curl / Node fetch) passes — the
    // happy-path tests elsewhere in this file rely on that.
    for (const site of ['same-origin', 'none']) {
      const ok = await fetch(`${url}/api/config`, { headers: { 'sec-fetch-site': site } });
      assert.equal(ok.status, 200);
    }
  });
});

test('import request bodies are capped', async () => {
  const configService = { async inspect() { return { agents: [], warnings: [] }; } };
  let reached = false;
  const transferService = {
    async planImport() { reached = true; return { error: null, plan: [], warnings: [] }; },
    async applyImport() { reached = true; return { error: null, results: [], warnings: [] }; },
  };

  await withServer({ configService, transferService }, async (url) => {
    const big = 'x'.repeat(11 * 1024 * 1024);
    const res = await fetch(`${url}/api/config/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-toksight-action': 'import' },
      body: JSON.stringify({ bundle: { content: big } }),
    });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).code, 'BODY_TOO_LARGE');
    assert.equal(reached, false);
  });
});

test('configuration API reports a missing service and inspect failures', async () => {
  await withServer({}, async (url) => {
    const missing = await fetch(`${url}/api/config`);
    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).code, 'CONFIG_UNAVAILABLE');
  });

  const configService = {
    async inspect() {
      throw new Error('disk on fire');
    },
  };
  await withServer({ configService }, async (url) => {
    const failed = await fetch(`${url}/api/config`);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: 'disk on fire', code: 'CONFIG_ERROR' });
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

test('API endpoints reject a forged Host header (DNS rebinding)', async () => {
  const configService = { async inspect() { return { agents: [], warnings: [] }; } };
  await withServer({ configService }, async (url) => {
    const port = Number(new URL(url).port);
    const get = (path, host) => `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;

    // A rebinding page: remoteAddress is 127.0.0.1, but the Host the browser
    // was tricked into requesting is the attacker's domain.
    for (const [path, host] of [['/api/config', 'evil.example'], ['/api/data', 'evil.example']]) {
      const raw = await rawRequest(port, get(path, host));
      assert.ok(raw.startsWith('HTTP/1.1 403'), `${path} with foreign Host must 403, got: ${raw.split('\r\n')[0]}`);
      assert.match(raw, /HOST_NOT_ALLOWED/);
    }

    // Localhost Hosts keep working, port or not.
    for (const [path, host] of [
      ['/api/config', '127.0.0.1'], ['/api/config', `localhost:${port}`],
      ['/api/data', '127.0.0.1'], ['/api/data', `localhost:${port}`],
    ]) {
      const raw = await rawRequest(port, get(path, host));
      assert.ok(raw.startsWith('HTTP/1.1 200'), `${path} with Host ${host} must 200, got: ${raw.split('\r\n')[0]}`);
    }
  });
});

test('a deliberately exposed server keeps serving /api/data to foreign Hosts', async () => {
  // --host 0.0.0.0 is an explicit opt-in to serve the LAN; the Host check
  // would only break that. /api/config stays strict regardless.
  const configService = { async inspect() { return { agents: [], warnings: [] }; } };
  await withServer({ host: '0.0.0.0', configService }, async (url) => {
    const port = Number(new URL(url).port);
    const get = (path, host) => `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;

    const data = await rawRequest(port, get('/api/data', 'server.lan.example'));
    assert.ok(data.startsWith('HTTP/1.1 200'), `exposed /api/data must serve, got: ${data.split('\r\n')[0]}`);

    const config = await rawRequest(port, get('/api/config', 'evil.example'));
    assert.ok(config.startsWith('HTTP/1.1 403'), `/api/config must stay Host-strict even on 0.0.0.0, got: ${config.split('\r\n')[0]}`);

    const localConfig = await rawRequest(port, get('/api/config', `localhost:${port}`));
    assert.ok(localConfig.startsWith('HTTP/1.1 200'), `/api/config from localhost must serve, got: ${localConfig.split('\r\n')[0]}`);
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

test('the config gates fire in order: cross-site beats method and content-type', async () => {
  const configService = { async inspect() { return { agents: [], warnings: [] }; } };
  const transferService = {
    async exportBundle() { return { bundle: { format: 'x', files: [] }, warnings: [] }; },
    async planImport() { return { error: null, plan: [], warnings: [] }; },
    async applyImport() { return { error: null, results: [], warnings: [] }; },
  };

  await withServer({ configService, transferService }, async (url) => {
    // text/plain (would be 415) + cross-site: the Fetch-Metadata gate fires
    // first, so a foreign page always sees CROSS_SITE_NOT_ALLOWED.
    const res = await fetch(`${url}/api/config/import`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' },
      body: 'x',
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'CROSS_SITE_NOT_ALLOWED');

    // Direct cross-site cases for the transfer routes (previously only the
    // inventory endpoint had one) — including a GET against an import route,
    // which pins that cross-site is checked before the 405.
    for (const route of ['/api/config/export', '/api/config/import/preview', '/api/config/import']) {
      const hit = await fetch(`${url}${route}`, { headers: { 'sec-fetch-site': 'cross-site' } });
      assert.equal(hit.status, 403, route);
      assert.equal((await hit.json()).code, 'CROSS_SITE_NOT_ALLOWED');
    }
  });
});

test('early-rejected writes drain the body before answering', async () => {
  const configService = { async inspect() { return { agents: [], warnings: [] }; } };
  const transferService = {
    async planImport() { throw new Error('must not be reached'); },
    async applyImport() { throw new Error('must not be reached'); },
  };

  await withServer({ configService, transferService }, async (url) => {
    const { port } = new URL(url);
    // Raw socket (not fetch): the 415 fires before the body is read, and the
    // server must drain the in-flight body so the client reliably receives
    // the full JSON error instead of a mid-upload connection reset.
    const raw = await rawRequest(
      port,
      'POST /api/config/import HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\nx-toksight-action: import\r\nContent-Length: 11\r\nConnection: close\r\n\r\nhello world',
    );
    assert.ok(raw.startsWith('HTTP/1.1 415'), `expected 415, got: ${raw.split('\r\n')[0]}`);
    assert.match(raw, /UNSUPPORTED_MEDIA_TYPE/);
  });
});
