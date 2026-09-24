// Minimal zero-dependency HTTP server for `toksight web`.
// Serves the prebuilt static dashboard and a SQLite-backed JSON API. GETs
// read a committed snapshot; POST /api/refresh collects and writes,
// POST /api/prices/update checks public rates, and POST /api/import/cursor
// imports a local Cursor usage CSV.

import http from 'node:http';
import { isIP } from 'node:net';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// No CORS headers: the API is same-origin with the served dashboard, and the
// dev setup proxies through Next rewrites (server-side, no browser CORS). An
// `Access-Control-Allow-Origin: *` here would let any website read local
// session data from browsers that allow simple cross-origin GETs.
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const MAX_CSV_BYTES = 20 * 1024 * 1024;

async function readCsvBody(req) {
  const sizeHeader = Number(req.headers['content-length']);
  if (Number.isFinite(sizeHeader) && sizeHeader > MAX_CSV_BYTES) {
    req.resume();
    const err = new Error('Cursor CSV is larger than 20 MB');
    err.status = 413;
    err.code = 'CSV_TOO_LARGE';
    throw err;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_CSV_BYTES) chunks.push(chunk);
  }
  if (size > MAX_CSV_BYTES) {
    const err = new Error('Cursor CSV is larger than 20 MB');
    err.status = 413;
    err.code = 'CSV_TOO_LARGE';
    throw err;
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch {
    const err = new Error('Cursor CSV must be UTF-8');
    err.status = 400;
    err.code = 'BAD_CSV';
    throw err;
  }
}

// Shown at / when web/out has not been built yet; the API keeps working so the
// dashboard can be developed against live data.
function setupPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>toksight web — 仪表盘尚未构建</title></head>
<body style="background:#f5f4ed radial-gradient(circle,rgba(20,20,19,.16) 1px,transparent 1.5px) 0 0/28px 28px;color:#141413;font:15px/1.7 system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;display:grid;place-items:center;min-height:96vh;margin:0">
  <main style="max-width:560px;padding:32px 36px;border:1px solid rgba(31,30,29,.14);border-radius:18px;background:#fffefb;box-shadow:0 8px 28px rgba(20,20,19,.06)">
    <h1 style="font:500 24px/1.3 Georgia,'Times New Roman',serif;margin:0 0 16px"><span style="color:#d97757">toksight</span> web · 仪表盘尚未构建</h1>
    <p style="color:#5e5d59">JSON API 已可用：<code style="color:#c6613f;background:#f0eee6;border-radius:6px;padding:1px 6px">/api/data</code>。要看到完整界面，请先构建静态资源（约需 1–2 分钟）：</p>
    <p style="color:#5e5d59">从源码运行：在仓库根目录执行以下命令，完成后刷新本页。</p>
    <pre style="background:#f0eee6;border-radius:10px;padding:14px 16px;overflow:auto"><code>npm run web:ci
npm run web:build</code></pre>
    <p style="color:#5e5d59">开发页面可运行 <code>npm run web:dev</code>，它会同时启动前端和 API。</p>
    <p style="color:#5e5d59">通过 npm 安装的版本应已包含页面。如果你使用的是安装包，请重新安装 <code>npm install -g toksight</code>，然后重新启动服务。</p>
  </main>
</body>
</html>
`;
}

function isInsideRoot(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function isLoopbackAddress(address) {
  if (!address) return false;
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  if (isIP(normalized) === 4) return normalized.split('.')[0] === '127';
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    return isIP(mapped) === 4 && mapped.split('.')[0] === '127';
  }
  return false;
}

// A DNS-rebinding page passes the remoteAddress check (its domain resolves
// to 127.0.0.1), so API requests also carry a Host the browser believes it
// is talking to. Requiring that Host to be a loopback name makes the
// rebinder's foreign origin fail the check.
export function isLocalHostHeader(hostHeader) {
  if (!hostHeader) return false;
  let host = hostHeader.trim().toLowerCase();
  // [::1]:4729 — strip the port before touching the bracketed address.
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close === -1) return false;
    host = host.slice(1, close);
  } else {
    const colon = host.lastIndexOf(':');
    // A bare IPv6 address has several colons but no port; host:port has
    // exactly one.
    if (colon !== -1 && host.indexOf(':') === colon) host = host.slice(0, colon);
  }
  return host === 'localhost' || isLoopbackAddress(host);
}

function sendJson(res, status, payload, method = 'GET', extraHeaders = {}) {
  res.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
  res.end(method === 'HEAD' ? undefined : JSON.stringify(payload));
}

const isLoopbackHost = (host) => host?.toLowerCase() === 'localhost' || isLoopbackAddress(host);

function isAllowedRefreshOrigin(req, localHostHeader, host) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true; // local CLI clients need no Origin
  try {
    const origin = new URL(req.headers.origin);
    if (!['http:', 'https:'].includes(origin.protocol)) return false;
    if (origin.host.toLowerCase() === req.headers.host?.toLowerCase()) return true;
    // Next dev proxies /api/* from its own loopback port to the API port.
    return isLoopbackHost(host) && localHostHeader && isLocalHostHeader(origin.host);
  } catch {
    return false;
  }
}

export function createWebServer({
  host = '127.0.0.1',
  port = 4729,
  outDir,
  getData,
  apiOnly = false,
  logger = console,
} = {}) {
  const root = path.resolve(outDir);
  const html = (extra = {}) => ({ 'content-type': MIME['.html'], ...extra });

  async function serveStatic(pathname, res) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    const target = path.resolve(root, rel);
    if (!isInsideRoot(root, target)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }

    let servedTarget = target;
    let body = await readFile(servedTarget).catch(() => null);
    if (body == null) {
      // Directory-style URL (`/foo/`) maps to foo/index.html.
      servedTarget = path.join(target, 'index.html');
      body = await readFile(servedTarget).catch(() => null);
    }
    if (body == null && path.extname(target) === '') {
      // Next static export emits app/<route>/page.js as <route>.html when
      // trailingSlash is disabled; keep the clean extensionless URL.
      servedTarget = `${target}.html`;
      body = await readFile(servedTarget).catch(() => null);
    }

    if (body != null) {
      const ext = path.extname(servedTarget).toLowerCase();
      const cacheable = (rel === '_next' || rel.startsWith('_next/')) && ext !== '.html';
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': cacheable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(body);
      return;
    }

    if (path.extname(pathname) !== '') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    // Extensionless miss: prefer the export's 404 page, then the SPA index,
    // then the not-yet-built setup instructions.
    const notFound = await readFile(path.join(root, '404.html'), 'utf8').catch(() => null);
    if (notFound != null) {
      res.writeHead(404, html());
      res.end(notFound);
      return;
    }
    const index = await readFile(path.join(root, 'index.html'), 'utf8').catch(() => null);
    if (index != null) {
      res.writeHead(200, html({ 'cache-control': 'no-cache' }));
      res.end(index);
      return;
    }
    res.writeHead(200, html());
    res.end(setupPage());
  }

  async function handle(req, res) {
    let url;
    let pathname;
    try {
      url = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad request');
      return;
    }
    if (pathname.includes('\0')) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad request');
      return;
    }

    // DNS-rebinding defense: a foreign page whose domain resolves to
    // 127.0.0.1 is still remoteAddress-loopback, but its Host header is not.
    const localHostHeader = isLocalHostHeader(req.headers.host);

    if (pathname === '/api/data' || pathname === '/api/refresh' || pathname === '/api/prices/update' || pathname === '/api/import/cursor') {
      // Loopback-bound servers (the default) reject foreign Host headers;
      // a user who deliberately binds --host 0.0.0.0 exposes the dashboard
      // to the LAN on purpose, so the Host check would only break that.
      if (isLoopbackHost(host) && !localHostHeader) {
        sendJson(res, 403, { error: 'requests with a foreign Host header are not accepted', code: 'HOST_NOT_ALLOWED' }, req.method);
        return;
      }
      const refresh = pathname === '/api/refresh';
      const priceUpdate = pathname === '/api/prices/update';
      const importing = pathname === '/api/import/cursor';
      const writing = refresh || priceUpdate || importing;
      const allowed = writing ? req.method === 'POST' : req.method === 'GET' || req.method === 'HEAD';
      if (!allowed) {
        sendJson(res, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' }, req.method, { allow: writing ? 'POST' : 'GET, HEAD' });
        return;
      }
      if (writing && !isAllowedRefreshOrigin(req, localHostHeader, host)) {
        sendJson(res, 403, { error: 'cross-origin write is not accepted', code: 'ORIGIN_NOT_ALLOWED' }, req.method);
        return;
      }
      try {
        if ((refresh && !getData.refresh) || (priceUpdate && !getData.updatePrices) || (importing && !getData.importCursor)) {
          sendJson(res, 501, { error: 'operation is not configured', code: 'NOT_IMPLEMENTED' }, req.method);
          return;
        }
        const payload = refresh ? await getData.refresh() : priceUpdate ? await getData.updatePrices()
          : importing ? await getData.importCursor(await readCsvBody(req)) : await getData(url.searchParams);
        sendJson(res, 200, payload, req.method);
      } catch (err) {
        const status = err?.status === 400 || err?.status === 413 ? err.status : 500;
        if (status === 500) logger?.warn?.(`toksight web: ${pathname} failed: ${err?.message || err}`);
        sendJson(res, status, { error: String(err?.message || err), ...(err?.code ? { code: err.code } : {}) }, req.method);
      }
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'not found', code: 'NOT_FOUND' }, req.method);
      return;
    }

    if (apiOnly) {
      sendJson(res, 404, { error: 'api-only mode: only /api/* endpoints are served' }, req.method);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
      res.end('method not allowed');
      return;
    }
    await serveStatic(pathname, res);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      // If the response already started (partial body on the wire), we can
      // only terminate it — writing a JSON error body would corrupt whatever
      // content-type was already sent.
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(500, JSON_HEADERS);
      res.end(JSON.stringify({ error: String(err?.message || err) }));
    });
  });

  return {
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', (err) => {
          if (err && err.code === 'EADDRINUSE') {
            reject(new Error(`port ${port} is already in use — try --port <other>`));
          } else {
            reject(err);
          }
        });
        server.listen(port, host, () => {
          const addr = server.address();
          const shownHost = host === '0.0.0.0' || host === '::' || host === '' ? '127.0.0.1' : host;
          resolve({ port: addr.port, url: `http://${shownHost}:${addr.port}` });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => server.close((err) => {
        try { getData?.close?.(); }
        catch (closeError) { reject(closeError); return; }
        if (err) reject(err);
        else resolve();
      }));
    },
  };
}
