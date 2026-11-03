// Both entry points render the same static frontend. Only I/O crosses the
// desktop boundary; the sidecar address and authentication token stay in Rust.
const MAX_DATABASE_BYTES = 256 * 1024 * 1024;
const BASE64_CHUNK = 24 * 1024; // Multiple of three, so joined chunks have no padding in the middle.

export function isDesktop() {
  return typeof window !== 'undefined' && typeof window.__TAURI__?.core?.invoke === 'function';
}

export async function syncDesktopTheme(theme) {
  if (!isDesktop()) return;
  await window.__TAURI__.window.getCurrentWindow().setTheme(theme === 'system' ? null : theme);
}

async function invoke(command, args) {
  try { return await window.__TAURI__.core.invoke(command, args); }
  catch (error) { throw error instanceof Error ? error : new Error(String(error)); }
}

function encode(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  const chunks = [];
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK))));
  }
  return chunks.join('');
}

function decode(value) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(value);
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(value.length / 4 * 3 - padding);
  // Decode in bounded chunks instead of allocating another full binary string.
  for (let start = 0, offset = 0; start < value.length; start += BASE64_CHUNK) {
    const chunk = atob(value.slice(start, start + BASE64_CHUNK));
    for (let i = 0; i < chunk.length; i++) bytes[offset++] = chunk.charCodeAt(i);
  }
  return bytes;
}

async function bodyBytes(body) {
  if (body instanceof Blob) {
    if (body.size > MAX_DATABASE_BYTES) throw new Error('Database files must be 256 MB or smaller.');
    return new Uint8Array(await body.arrayBuffer());
  }
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  throw new TypeError('Unsupported desktop request body');
}

function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError');
}

function checkAbort(signal) { if (signal?.aborted) throw abortError(signal); }

// Cancelling a read immediately rejects its consumer and ignores the eventual
// IPC result. It does not undo an already submitted mutation in the sidecar.
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function apiFetch(path, init = {}) {
  if (!isDesktop()) return fetch(path, init);
  checkAbort(init.signal);
  if (typeof path !== 'string' || !path.startsWith('/api/') || /[\\#]/.test(path)) {
    throw new TypeError('Desktop requests must use a local /api/ path');
  }
  const method = (init.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new TypeError('Unsupported desktop request method');
  const bytes = init.body == null ? null : await bodyBytes(init.body);
  if (bytes?.length > MAX_DATABASE_BYTES) throw new Error('Database files must be 256 MB or smaller.');
  checkAbort(init.signal);
  const bodyBase64 = bytes ? encode(bytes) : undefined;
  checkAbort(init.signal);
  const reply = await abortable(invoke('desktop_request', {
    path, method, bodyBase64,
    contentType: new Headers(init.headers).get('content-type') || (init.body instanceof Blob ? init.body.type : undefined),
  }), init.signal);
  checkAbort(init.signal);
  return new Response([204, 205, 304].includes(reply.status) ? null : decode(reply.bodyBase64), {
    status: reply.status, headers: reply.headers,
  });
}

// A completed native save returns true; cancelling the OS dialog is a normal
// false result. Browser downloads retain their existing anchor-based behavior.
export async function saveFile(filename, contents) {
  if (isDesktop()) {
    let bodyBase64;
    if (typeof contents === 'string') {
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(contents);
      if (!match) throw new TypeError('Expected a PNG data URL');
      bodyBase64 = match[1];
    } else bodyBase64 = encode(await bodyBytes(contents));
    return Boolean(await invoke('desktop_save', { filename, bodyBase64 }));
  }
  const objectUrl = typeof contents !== 'string';
  const url = objectUrl ? URL.createObjectURL(contents) : contents;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

export function installDesktopLinks(onError) {
  if (!isDesktop()) return () => {};
  const open = (event) => {
    if (event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) return;
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, window.location.href);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin === window.location.origin) return;
    event.preventDefault();
    void invoke('desktop_open_url', { url: url.href }).catch(onError);
  };
  document.addEventListener('click', open);
  document.addEventListener('auxclick', open);
  return () => {
    document.removeEventListener('click', open);
    document.removeEventListener('auxclick', open);
  };
}
