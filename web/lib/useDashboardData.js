'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useDashboardData() {
  const [query, setQuery] = useState(null);
  const [data, setData] = useState(null);
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  // `pending` tracks non-silent requests. `loading` (pending with no data
  // yet) gates the first-paint skeleton; `refreshing` (any in-flight
  // request) spins the masthead icon while the old data stays on screen.
  // `version` bumps on each successful non-silent load and drives the
  // 200ms content fade (spec v7 §4); silent auto-refreshes don't bump it.
  const [pending, setPending] = useState(true);
  const [version, setVersion] = useState(0);
  const active = useRef(null);
  const sequence = useRef(0);
  useEffect(() => {
    const read = () => setQuery(window.location.search.slice(1));
    read(); window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (query == null) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const current = ++sequence.current;
    if (!silent) setPending(true);
    try {
      const res = await fetch(`/api/data${query ? `?${query}` : ''}`, { cache: 'no-store', signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (current !== sequence.current) return;
      setData(body); setView(body.view); setError(null);
      if (!silent) setVersion((v) => v + 1);
    } catch (err) {
      if (!controller.signal.aborted && current === sequence.current) setError(String(err.message || err));
    } finally { if (current === sequence.current && !controller.signal.aborted) setPending(false); }
  }, [query]);
  useEffect(() => {
    // Keep the previous response on screen while the next query loads; the
    // masthead spinner (`refreshing`) is the progress signal, not a skeleton.
    setError(null); void load();
    return () => { active.current?.abort(); sequence.current++; };
  }, [load]);
  const applyQuery = (next) => {
    window.history.replaceState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
    if (next === query) void load(); else setQuery(next);
  };
  const loading = pending && !data;
  const refreshing = pending;
  return { data, view, error, loading, refreshing, version, load, query: query ?? '', applyQuery };
}
