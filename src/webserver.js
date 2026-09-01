// Minimal zero-dependency HTTP server for `toksight web`.
// Serves the prebuilt static dashboard from web/out and a live JSON API at
// /api/data. The API re-collects agent data on every request, so a browser
// refresh always reflects the latest session files.

import http from 'node:http';
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
};

// Shown at / when web/out has not been built yet; the API keeps working so the
// dashboard can be developed against live data.
function setupPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>toksight web — 仪表盘尚未构建</title></head>
<body style="background:#0d1117;color:#e6edf3;font:15px/1.7 ui-sans-serif,system-ui,'Segoe UI','Microsoft YaHei',sans-serif;display:grid;place-items:center;min-height:96vh;margin:0">
  <main style="max-width:560px;padding:32px">
    <h1 style="font-size:20px">toksight web · 仪表盘尚未构建</h1>
    <p style="color:#8b949e">JSON API 已可用：<code style="color:#79c0ff">/api/data</code>。要看到完整界面，请先构建静态资源（约需 1–2 分钟）：</p>
    <pre style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 16px;overflow:auto"><code>cd web
npm install
npm run build</code></pre>
    <p style="color:#8b949e">或在仓库根目录执行 <code style="color:#79c0ff">npm run web:build</code>，然后重启 <code style="color:#79c0ff">toksight web</code> 并刷新本页。</p>
  </main>
</body>
</html>
`;
}

function isInsideRoot(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function createWebServer({ host = '127.0.0.1', port = 4729, outDir, getData, apiOnly = false, logger = console } = {}) {
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

    let body = await readFile(target).catch(() => null);
    if (body == null) {
      // Directory-style URL (`/foo/`) maps to foo/index.html.
      body = await readFile(path.join(target, 'index.html')).catch(() => null);
    }

    if (body != null) {
      const ext = path.extname(target).toLowerCase();
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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('method not allowed');
      return;
    }
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

    if (pathname === '/api/data') {
      try {
        const payload = await getData();
        res.writeHead(200, JSON_HEADERS);
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(payload));
      } catch (err) {
        logger?.warn?.(`toksight web: /api/data failed: ${err?.message || err}`);
        res.writeHead(500, JSON_HEADERS);
        res.end(JSON.stringify({ error: String(err?.message || err) }));
      }
      return;
    }

    if (apiOnly) {
      res.writeHead(404, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'api-only mode: only /api/* endpoints are served' }));
      return;
    }
    await serveStatic(pathname, res);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(500, JSON_HEADERS);
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
