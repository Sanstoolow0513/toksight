'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { periodBounds } from './period.js';

// Loads /api/data for one local date range. The previous result stays on
// screen (tagged with what it was requested for) while the next one loads,
// and an aborted or superseded request can never overwrite a newer one.
// Without a range nothing loads and the last result is kept.
function useRange(since, until, tag) {
  const [state, setState] = useState({ data: null, tag: null, error: null, loading: false });
  const active = useRef(null);
  const sequence = useRef(0);
  const latest = useRef(tag);
  latest.current = tag;

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
      if (current === sequence.current) setState({ data: body, tag: requested, error: null, loading: false });
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

// One calendar period (month or year) for the main report.
export function useReport(period) {
  const bounds = period ? periodBounds(period) : null;
  const { tag, ...rest } = useRange(bounds?.since, bounds?.until, period);
  return { ...rest, period: tag };
}

// One local day for the day panel; `day` null (panel closed) keeps the last day.
export function useDayReport(day) {
  const { tag, ...rest } = useRange(day, day, day);
  return { ...rest, day: tag };
}
