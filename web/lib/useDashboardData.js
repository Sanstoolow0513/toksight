'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useDashboardData() {
  const [query, setQuery] = useState(null);
  const [data, setData] = useState(null);
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
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
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/data${query ? `?${query}` : ''}`, { cache: 'no-store', signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (current !== sequence.current) return;
      setData(body); setView(body.view); setError(null);
    } catch (err) {
      if (!controller.signal.aborted && current === sequence.current) setError(String(err.message || err));
    } finally { if (current === sequence.current && !controller.signal.aborted) setLoading(false); }
  }, [query]);
  useEffect(() => {
    setData(null); setError(null); void load();
    return () => { active.current?.abort(); sequence.current++; };
  }, [load]);
  const applyQuery = (next) => {
    window.history.replaceState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
    if (next === query) void load(); else setQuery(next);
  };
  return { data, view, error, loading, load, query: query ?? '', applyQuery };
}
