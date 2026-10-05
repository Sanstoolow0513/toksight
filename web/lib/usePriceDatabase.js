import { useCallback, useEffect, useRef, useState } from 'react';

export function usePriceDatabase() {
  const [status, setStatus] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const sequence = useRef(0), controller = useRef(null);
  const reload = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController(), id = ++sequence.current;
    controller.current = request;
    try {
      const response = await fetch('/api/prices/status', { cache: 'no-store', signal: request.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (id === sequence.current) { setStatus(body); setError(null); }
      return body;
    } catch (err) { if (err.name !== 'AbortError' && id === sequence.current) setError(err.message); }
  }, []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 60000);
    const focus = () => void reload();
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); ++sequence.current; controller.current?.abort(); };
  }, [reload]);
  const mutate = useCallback(async (url, options) => {
    setBusy(true); setError(null);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      controller.current?.abort(); ++sequence.current;
      setStatus(body);
      return body;
    } catch (err) { setError(err.message); throw err; }
    finally { setBusy(false); }
  }, []);
  const setup = useCallback((options) => mutate('/api/setup', options), [mutate]);
  const reset = useCallback(() => mutate('/api/prices/reset', {}), [mutate]);
  return { status, error, busy, reload, setup, reset };
}
