import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createWebServer } from '../src/webserver.js';

const payload = { tool: 'toksight', totals: { totalTokens: 42 }, warnings: [] };

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
  fs.mkdirSync(path.join(dir, '_next', 'static'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_next', 'static', 'app.js'), 'console.log(1)');

  await withServer({ outDir: dir }, async (url) => {
    const home = await fetch(`${url}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.equal(await home.text(), '<html>toksight dashboard</html>');

    const asset = await fetch(`${url}/_next/static/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'console.log(1)');

    const missing = await fetch(`${url}/nope.css`);
    assert.equal(missing.status, 404);
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
