'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { periodBounds } from './period.js';

// Loads /api/data for one calendar period. The previous result stays on
// screen (tagged with the period it belongs to) while the next one loads, and
// an aborted or superseded request can never overwrite a newer one.
export function useReport(period) {
  const [state, setState] = useState({ data: null, period: null, error: null, loading: false });
  const active = useRef(null);
  const sequence = useRef(0);
  const latest = useRef(period);
  latest.current = period;
  const bounds = period ? periodBounds(period) : null;
  const since = bounds?.since;
  const until = bounds?.until;

  const load = useCallback(async () => {
    if (!since) return;
    const requested = latest.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const current = ++sequence.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`/api/data?period=custom&since=${since}&until=${until}`, { cache: 'no-store', signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (current === sequence.current) setState({ data: body, period: requested, error: null, loading: false });
    } catch (err) {
      if (!controller.signal.aborted && current === sequence.current) {
        setState((s) => ({ ...s, error: String(err?.message || err), loading: false }));
      }
    }
  }, [since, until]);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load]);

  return { ...state, reload: load };
}
