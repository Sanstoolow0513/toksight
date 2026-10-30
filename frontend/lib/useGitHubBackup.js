'use client';
import { useCallback, useEffect, useState } from 'react';

// GitHub backup settings and actions (/api/sync/*). Status is local-only and
// loads when Settings opens; the token never comes back from the server.
async function request(url, init) {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { code: body.code, retryAt: body.retryAt });
  return body;
}
const post = (url, body) => request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

export function useGitHubBackup(active) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null); // 'save' | 'upload' | 'restore'
  const [error, setError] = useState(null); // { action, code, message, retryAt }
  const [confirming, setConfirming] = useState(false);

  const reload = useCallback(async () => {
    try { setStatus(await request('/api/sync/status')); }
    catch (err) { setError({ action: 'load', code: err.code, message: err.message }); }
  }, []);
  useEffect(() => { if (active) void reload(); }, [active, reload]);

  const run = useCallback(async (action, fn) => {
    setBusy(action);
    setError(null);
    try {
      const body = await fn();
      setStatus(body);
      return body;
    } catch (err) {
      setError({ action, code: err.code, message: err.message, retryAt: err.retryAt });
      if (action !== 'save') void reload();
      return null;
    } finally { setBusy(null); }
  }, [reload]);

  const save = useCallback((settings) => run('save', () => post('/api/sync/config', settings)), [run]);
  const upload = useCallback(() => run('upload', () => post('/api/sync/upload')), [run]);
  const restore = useCallback(() => run('restore', () => post('/api/sync/restore')), [run]);
  return { status, busy, error, confirming, setConfirming, setError, save, upload, restore, reload };
}
