import { useCallback, useEffect, useRef, useState } from 'react';

// GET /api/quota is local-only (Codex logs + the last Kimi result kept in
// server memory); only refresh() POSTs and lets the server query Kimi Code.
export function useQuota(revision) {
  const [payload, setPayload] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const sequence = useRef(0), controller = useRef(null), posting = useRef(false);
  const load = useCallback(async (method = 'GET') => {
    // A focus or revision GET must not cancel a Kimi refresh in flight.
    if (method === 'GET' && posting.current) return;
    controller.current?.abort();
    posting.current = method === 'POST';
    const request = new AbortController(), id = ++sequence.current;
    controller.current = request;
    if (method === 'POST') setBusy(true);
    try {
      const response = await fetch(method === 'POST' ? '/api/quota/refresh' : '/api/quota', { method, cache: 'no-store', signal: request.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (id === sequence.current) { setPayload(body); setError(null); }
    } catch (err) { if (err.name !== 'AbortError' && id === sequence.current) setError(err.message); }
    finally { if (id === sequence.current) { setBusy(false); posting.current = false; } }
  }, []);
  useEffect(() => {
    void load();
    const focus = () => void load();
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('focus', focus); ++sequence.current; controller.current?.abort(); };
  }, [load, revision]);
  const refresh = useCallback(() => load('POST'), [load]);
  return { payload, error, busy, refresh };
}
