// Minimal zero-dependency HTTP server for `toksight web`.
// Serves the prebuilt static dashboard from web/out and a live JSON API at
// /api/data plus the read-only agent configuration inventory at /api/config.
// The data API re-collects on every request, so a browser refresh always
// reflects the latest session files.

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

// Shown at / when web/out has not been built yet; the API keeps working so the
// dashboard can be developed against live data.
function setupPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>toksight web — 仪表盘尚未构建</title></head>
<body style="background:#060609;color:#e8e8f2;font:14px/1.7 ui-monospace,'Cascadia Code',Consolas,monospace;display:grid;place-items:center;min-height:96vh;margin:0">
  <main style="max-width:560px;padding:32px;border:2px solid #4a4a5e;background:#0e0e15">
    <h1 style="font-size:14px;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 16px"><span style="background:#c9f24b;color:#060609;padding:2px 8px">toksight</span> web · 仪表盘尚未构建</h1>
    <p style="color:#82829c">JSON API 已可用：<code style="color:#c9f24b;background:#15151f;border:1px solid #26262f;padding:0 4px">/api/data</code>。要看到完整界面和配置迁移页，请先构建静态资源（约需 1–2 分钟）：</p>
    <pre style="background:#15151f;border:1px solid #4a4a5e;padding:14px 16px;overflow:auto"><code>cd web
npm install
npm run build</code></pre>
    <p style="color:#82829c">或在仓库根目录执行 <code style="color:#c9f24b;background:#15151f;border:1px solid #26262f;padding:0 4px">npm run web:build</code>，然后重启 <code style="color:#c9f24b;background:#15151f;border:1px solid #26262f;padding:0 4px">toksight web</code> 并刷新本页。</p>
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

export function createWebServer({
  host = '127.0.0.1',
  port = 4729,
  outDir,
  getData,
  configService,
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
      // Next static export emits app/config/page.js as config.html when
      // trailingSlash is disabled. Preserve the clean browser URL /config.
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
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
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

    if (pathname === '/api/data') {
      // Loopback-bound servers (the default) reject foreign Host headers;
      // a user who deliberately binds --host 0.0.0.0 exposes the dashboard
      // to the LAN on purpose, so the Host check would only break that.
      if (isLoopbackAddress(host) && !localHostHeader) {
        sendJson(res, 403, { error: 'requests with a foreign Host header are not accepted', code: 'HOST_NOT_ALLOWED' }, req.method);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' }, req.method, { allow: 'GET, HEAD' });
        return;
      }
      try {
        const payload = await getData();
        sendJson(res, 200, payload, req.method);
      } catch (err) {
        logger?.warn?.(`toksight web: /api/data failed: ${err?.message || err}`);
        sendJson(res, 500, { error: String(err?.message || err) }, req.method);
      }
      return;
    }

    if (pathname === '/api/config' || pathname.startsWith('/api/config/')) {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        sendJson(res, 403, { error: 'configuration endpoint is only available from this machine', code: 'LOOPBACK_ONLY' }, req.method);
        return;
      }
      if (!localHostHeader) {
        sendJson(res, 403, { error: 'configuration endpoint requires a localhost Host header', code: 'HOST_NOT_ALLOWED' }, req.method);
        return;
      }
      if (!configService) {
        sendJson(res, 503, { error: 'configuration service is unavailable', code: 'CONFIG_UNAVAILABLE' }, req.method);
        return;
      }
      // Read-only by design: the inventory endpoint never accepts request
      // bodies, so nothing but GET/HEAD ever reaches the config service.
      if (pathname !== '/api/config') {
        sendJson(res, 404, { error: 'not found', code: 'NOT_FOUND' }, req.method);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' }, req.method, { allow: 'GET, HEAD' });
        return;
      }
      try {
        sendJson(res, 200, await configService.inspect(), req.method);
      } catch (err) {
        logger?.warn?.(`toksight web: /api/config failed: ${err?.message || err}`);
        sendJson(res, 500, { error: String(err?.message || err), code: 'CONFIG_ERROR' }, req.method);
      }
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
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
