'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { periodBounds } from './period.js';

// Loads /api/data for one local date range. The previous result stays on
// screen (tagged with what it was requested for) while the next one loads,
// and an aborted or superseded request can never overwrite a newer one.
// Without a range nothing loads and the last result is kept.
function useRange(since, until, tag, revision = 0, agent = '', timezone) {
  const [state, setState] = useState({ data: null, tag: null, error: null, loading: false });
  const active = useRef(null);
  const sequence = useRef(0);
  const latest = useRef(tag);
  latest.current = tag;
  const tagKey = JSON.stringify(tag);

  const load = useCallback(async () => {
    if (!since) { setState((s) => ({ ...s, loading: false })); return; }
    const requested = latest.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const current = ++sequence.current;
    setState((s) => ({ ...s, error: null, loading: true }));
    try {
      const query = new URLSearchParams({ period: 'custom', since, until });
      if (agent) query.set('client', agent);
      if (timezone) query.set('timezone', timezone);
      const res = await fetch(`/api/data?${query}`, { cache: 'no-store', signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (!controller.signal.aborted && current === sequence.current) setState({ data: body, tag: requested, error: null, loading: false });
    } catch (err) {
      if (!controller.signal.aborted && current === sequence.current) {
        setState((s) => ({ ...s, error: String(err?.message || err), loading: false }));
      }
    }
  }, [since, until, agent, timezone, tagKey]);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load, revision]);

  return { ...state, reload: load };
}

// One calendar period or custom range, with the selected agent.
export function useReport(period, revision = 0, agent = '', timezone) {
  const bounds = period ? periodBounds(period) : null;
  const { tag, ...rest } = useRange(bounds?.since, bounds?.until, { period, agent, timezone }, revision, agent, timezone);
  return { ...rest, period: tag?.period, agent: tag?.agent, timezone: tag?.timezone };
}

// One day in the inline calendar detail; a null day pauses loading.
export function useDayReport(day, revision = 0, agent = '', timezone) {
  const { tag, ...rest } = useRange(day, day, { day, agent, timezone }, revision, agent, timezone);
  // Never expose a previous agent's details under the newly selected agent.
  return { ...rest, data: tag?.agent === agent && tag?.timezone === timezone ? rest.data : null, day: tag?.day, timezone: tag?.timezone };
}
