// Minimal zero-dependency HTTP server for `toksight web`.
// Serves the prebuilt static dashboard from web/out and a live JSON API at
// /api/data plus the agent configuration endpoints at /api/config: the
// read-only inventory, the bundle export, and the (preview → apply) import —
// the only write path in toksight. The data API re-collects on every request,
// so a browser refresh always reflects the latest session files.

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
    <p style="color:#82829c">JSON API 已可用：<code style="color:#c9f24b;background:#15151f;border:1px solid #26262f;padding:0 4px">/api/data</code>。要看到完整界面和配置页，请先构建静态资源（约需 1–2 分钟）：</p>
    <p style="color:#82829c">从源码运行：在仓库根目录执行以下命令，完成后刷新本页。</p>
    <pre style="background:#15151f;border:1px solid #4a4a5e;padding:14px 16px;overflow:auto"><code>npm run web:ci
npm run web:build</code></pre>
    <p style="color:#82829c">开发页面可运行 <code>npm run web:dev</code>，它会同时启动前端和 API。</p>
    <p style="color:#82829c">通过 npm 安装的版本应已包含页面。如果你使用的是安装包，请重新安装 <code>npm install -g toksight</code>，然后重新启动服务。</p>
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

// Fetch-Metadata check: modern browsers stamp every request with
// Sec-Fetch-Site. same-origin (dashboard → API) and none (address bar,
// bookmarks) are fine; cross-site means a foreign page initiated the request.
// Non-browser clients (curl, Node's fetch) do not send the header at all —
// absence passes, they already cleared the loopback gate.
export function isCrossSiteRequest(req) {
  const site = req?.headers?.['sec-fetch-site'];
  if (site == null) return false;
  const value = String(site).toLowerCase();
  return value !== 'same-origin' && value !== 'none';
}

// Body cap for import requests. The export side never bundles a file above
// 1 MB, so 10 MB leaves comfortable room for a full five-agent bundle while
// still bounding memory use.
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

// The one error type the routing layer understands: carries the HTTP status
// and the machine-readable code for the JSON error body. failRequest maps any
// thrown value — HttpError or not — to a response.
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Write-request gate: requires an application/json content type AND the
// x-toksight-action header matching the endpoint's action. Both are
// CORS-safelisted violations, so a browser enforces a preflight before the
// request is ever sent — and with no CORS headers on this server the
// preflight fails. A text/plain form POST (the classic no-preflight CSRF
// shape) is rejected here outright.
export function guardWriteRequest(req, action) {
  const contentType = String(req?.headers?.['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'import requests must have content-type application/json');
  }
  if (String(req?.headers?.['x-toksight-action'] || '') !== action) {
    throw new HttpError(403, 'ACTION_HEADER_REQUIRED', `missing or wrong x-toksight-action header (expected "${action}")`);
  }
}

// Reads and JSON-parses a request body with a hard byte cap. On overflow the
// remaining body is drained (chunks discarded, nothing buffered) and the
// promise rejects at stream end — the route can then answer with a 413 that
// reliably reaches the client. Draining rather than destroying the socket
// avoids a race where the error response is cut off mid-flight; the server is
// loopback-only anyway, so there is no remote attacker to DoS with a slow
// body. Rejects with an HttpError carrying the right HTTP status.
export function readJsonBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let overflow = null;
    req.on('data', (chunk) => {
      if (overflow) return; // keep draining past the cap, discard
      total += chunk.length;
      if (total > limitBytes) {
        overflow = new HttpError(413, 'BODY_TOO_LARGE', `request body exceeds ${limitBytes} bytes`);
        chunks.length = 0; // nothing is kept from an oversized body
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) {
        reject(overflow);
        return;
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        reject(new HttpError(400, 'BAD_JSON', 'request body is not valid JSON'));
        return;
      }
      resolve(body);
    });
    req.on('error', (err) => {
      // Overflow already doomed the request — settle with THAT error (the
      // meaningful 413) so the promise can never hang when the stream errors
      // mid-drain.
      reject(overflow ?? err);
    });
  });
}

// Best-effort body drain for requests that get rejected before their body
// was read (405/415/403/503): answering mid-upload can surface as a
// connection reset instead of the JSON error on some clients, which is why
// the 413 path deliberately drains first — this extends the same behavior to
// every early rejection. Idempotent and safe on any request: finished or
// destroyed streams return immediately. Like the 413 drain, there is no
// timeout — the server is loopback-only, so no remote party can hold it
// open with a slow body.
export function drainBody(req) {
  if (req?.readableEnded || req?.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    req.on('end', resolve);
    req.on('close', resolve);
    req.on('error', resolve);
    req.resume();
  });
}

function sendJson(res, status, payload, method = 'GET', extraHeaders = {}) {
  res.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
  res.end(method === 'HEAD' ? undefined : JSON.stringify(payload));
}

// Business-level shape check for an import request body: exactly one of a
// bundle object or a backupId string, plus optional selected file ids and
// expected target/content revisions carried over from a preview. Throws
// HttpError(400) on any malformed shape; the service layer sees only the
// validated pieces.
function validateImportBody(body) {
  const restoring = body?.backupId != null;
  const bundle = body?.bundle;
  if (restoring ? typeof body.backupId !== 'string' || bundle != null : !bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new HttpError(400, 'BAD_REQUEST', 'provide either a bundle object or a backupId string');
  }
  let selected;
  if (body.selected != null) {
    if (!Array.isArray(body.selected) || body.selected.some((entry) => typeof entry !== 'string')) {
      throw new HttpError(400, 'BAD_REQUEST', 'selected must be an array of file ids');
    }
    selected = body.selected;
  }
  const options = { selected };
  if (body.expected != null) {
    const expected = body.expected;
    const hash = /^(?:missing|[a-f0-9]{64})$/;
    if (typeof expected !== 'object' || Array.isArray(expected) || Object.values(expected).some((value) =>
      !value || typeof value.target !== 'string' || !hash.test(value.target) || typeof value.content !== 'string' || !/^[a-f0-9]{64}$/.test(value.content))) {
      throw new HttpError(400, 'BAD_REQUEST', 'expected must contain target/content revisions from a preview');
    }
    options.expected = expected;
  }
  return { bundle, backupId: restoring ? body.backupId : null, options };
}

// Single error exit for the config API routes: maps any thrown value to the
// JSON error response. 5xx is logged; the body is drained first so the client
// reliably receives this JSON error instead of a mid-upload connection reset
// (415/403 fire before the body is read, 400s after it was — draining is
// idempotent).
async function failRequest(req, res, pathname, err, logger) {
  const status = Number.isFinite(err?.status) ? err.status : 500;
  if (status >= 500) logger?.warn?.(`toksight web: ${pathname} failed: ${err?.message || err}`);
  await drainBody(req);
  sendJson(res, status, { error: String(err?.message || err), code: err?.code || 'TRANSFER_ERROR' }, req.method);
}

// /api/data maps a 400 from query validation straight through and keeps the
// error code only when one was attached — a different contract from the
// config routes, so it keeps its own catch instead of failRequest.
async function serveData({ res, url, method, getData, logger }) {
  try {
    sendJson(res, 200, await getData(url.searchParams), method);
  } catch (err) {
    const status = err?.status === 400 ? 400 : 500;
    if (status === 500) logger?.warn?.(`toksight web: /api/data failed: ${err?.message || err}`);
    sendJson(res, status, { error: String(err?.message || err), ...(err?.code ? { code: err.code } : {}) }, method);
  }
}

// Read-only inventory: GET/HEAD only, never a request body.
async function serveInventory({ res, method, configService }) {
  try {
    sendJson(res, 200, await configService.inspect(), method);
  } catch (err) {
    throw new HttpError(500, 'CONFIG_ERROR', String(err?.message || err));
  }
}

async function serveBackups({ res, method, transferService }) {
  try {
    sendJson(res, 200, await transferService.listBackups(), method);
  } catch {
    sendJson(res, 500, { error: 'cannot list backups', code: 'TRANSFER_ERROR' }, method);
  }
}

// Bundle export: same GET semantics as the inventory, plus a
// Content-Disposition so the dashboard can offer it as a download.
async function serveExport({ res, url, method, transferService }) {
  let exported;
  try {
    exported = await transferService.exportBundle({
      agents: url.searchParams.get('agents') || undefined,
      files: url.searchParams.get('files') || undefined,
    });
  } catch (err) {
    throw new HttpError(500, 'TRANSFER_ERROR', String(err?.message || err));
  }
  sendJson(
    res,
    200,
    { ...exported.bundle, warnings: exported.warnings },
    method,
    { 'content-disposition': 'attachment; filename="toksight-agent-configs.json"' },
  );
}

// Import endpoints — the only write path in toksight. Beyond the
// loopback/Host/Fetch-Metadata gates shared with the read side, a
// browser-initiated write requires a JSON content type AND the
// x-toksight-action header: both force a CORS preflight, and this server
// answers no preflight (no CORS headers at all), so a foreign page can never
// fire a state-changing request at it.
async function serveImport({ req, res, method, transferService }, preview) {
  const { bundle, backupId, options } = validateImportBody(await readJsonBody(req, MAX_IMPORT_BYTES));
  let resolved = bundle;
  if (backupId != null) {
    try {
      resolved = await transferService.bundleFromBackup(backupId);
    } catch {
      throw new HttpError(400, 'BAD_BACKUP', 'backup is unavailable, ambiguous or not a regular allowlisted file');
    }
  }
  const result = preview
    ? await transferService.planImport(resolved, options)
    : await transferService.applyImport(resolved, options);
  if (result.error) {
    sendJson(res, 400, { error: result.error, code: 'BAD_BUNDLE' }, method);
    return;
  }
  sendJson(res, 200, result, method);
}

const hasTransfer = ({ transferService }) => Boolean(transferService);

// Declarative API routing. Each entry declares its path, allowed methods, the
// service it needs (checked after the method check), and whether it is a
// write (guarded by guardWriteRequest with the given action). `config` marks
// routes under the /api/config umbrella gates. Handlers receive
// { req, res, url, method, getData, configService, transferService, logger }.
const API_ROUTES = [
  { path: '/api/data', methods: ['GET', 'HEAD'], handler: serveData },
  { path: '/api/config', methods: ['GET', 'HEAD'], config: true, handler: serveInventory },
  {
    path: '/api/config/backups',
    methods: ['GET', 'HEAD'],
    config: true,
    needs: ({ transferService }) => Boolean(transferService?.listBackups),
    unavailable: 'backup service is unavailable',
    handler: serveBackups,
  },
  { path: '/api/config/export', methods: ['GET', 'HEAD'], config: true, needs: hasTransfer, handler: serveExport },
  { path: '/api/config/import/preview', methods: ['POST'], config: true, needs: hasTransfer, write: 'import-preview', handler: (ctx) => serveImport(ctx, true) },
  { path: '/api/config/import', methods: ['POST'], config: true, needs: hasTransfer, write: 'import', handler: (ctx) => serveImport(ctx, false) },
];

export function createWebServer({
  host = '127.0.0.1',
  port = 4729,
  outDir,
  getData,
  configService,
  transferService,
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
    const route = API_ROUTES.find((entry) => entry.path === pathname);
    const ctx = { req, res, url, method: req.method, getData, configService, transferService, logger };

    if (route && !route.config) {
      // Loopback-bound servers (the default) reject foreign Host headers;
      // a user who deliberately binds --host 0.0.0.0 exposes the dashboard
      // to the LAN on purpose, so the Host check would only break that.
      if (isLoopbackAddress(host) && !localHostHeader) {
        sendJson(res, 403, { error: 'requests with a foreign Host header are not accepted', code: 'HOST_NOT_ALLOWED' }, req.method);
        return;
      }
      if (!route.methods.includes(req.method)) {
        sendJson(res, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' }, req.method, { allow: route.methods.join(', ') });
        return;
      }
      await route.handler(ctx);
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
      // Fetch-Metadata defense (browsers send Sec-Fetch-Site; curl and
      // Node's fetch do not, so absence passes): a cross-site browser request
      // aimed at these endpoints is rejected regardless of anything else.
      if (isCrossSiteRequest(req)) {
        sendJson(res, 403, { error: 'cross-site requests are not accepted', code: 'CROSS_SITE_NOT_ALLOWED' }, req.method);
        return;
      }
      if (!configService) {
        await drainBody(req); // consume an in-flight body before answering
        sendJson(res, 503, { error: 'configuration service is unavailable', code: 'CONFIG_UNAVAILABLE' }, req.method);
        return;
      }
      if (!route) {
        sendJson(res, 404, { error: 'not found', code: 'NOT_FOUND' }, req.method);
        return;
      }
      if (!route.methods.includes(req.method)) {
        await drainBody(req);
        sendJson(res, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' }, req.method, { allow: route.methods.join(', ') });
        return;
      }
      if (route.needs && !route.needs(ctx)) {
        await drainBody(req);
        sendJson(res, 503, { error: route.unavailable || 'transfer service is unavailable', code: 'TRANSFER_UNAVAILABLE' }, req.method);
        return;
      }
      try {
        if (route.write) guardWriteRequest(req, route.write);
        await route.handler(ctx);
      } catch (err) {
        await failRequest(req, res, pathname, err, logger);
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
