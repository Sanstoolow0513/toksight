import { useCallback, useEffect, useRef, useState } from 'react';

// Mounted only in the price view. History loads on demand for one catalog ID.
export function usePriceCatalog(key = null, revision = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const controller = useRef(null), sequence = useRef(0);
  const reload = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController(), id = ++sequence.current;
    controller.current = request;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const query = key == null ? '' : '?' + new URLSearchParams({ key });
      const response = await fetch('/api/prices' + query, { cache: 'no-store', signal: request.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (!request.signal.aborted && id === sequence.current) setState({ data: body, loading: false, error: null });
    } catch (err) {
      if (!request.signal.aborted && id === sequence.current) setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, [key]);
  useEffect(() => {
    void reload();
    const timer = key == null ? setInterval(() => void reload(), 60000) : null;
    const focus = () => void reload();
    if (key == null) window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); ++sequence.current; controller.current?.abort(); };
  }, [reload, key, revision]);
  return { ...state, reload };
}
