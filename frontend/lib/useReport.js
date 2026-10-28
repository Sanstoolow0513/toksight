'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { periodBounds } from './period.js';

// Loads /api/data for one local date range (optionally only some of its
// days). The previous result stays on screen (tagged with what it was
// requested for) while the next one loads, and an aborted or superseded
// request can never overwrite a newer one. Without a range nothing loads and
// the last result is kept.
function useRange({ since, until, days = null, agent = '', timezone }, tag, revision = 0) {
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
      if (days) query.set('days', days);
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
  }, [since, until, days, agent, timezone, tagKey]);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load, revision]);

  return { ...state, reload: load };
}

// One calendar period or custom range for all agents.
export function useReport(period, revision = 0, timezone) {
  const bounds = period ? periodBounds(period) : null;
  const { tag, ...rest } = useRange({ since: bounds?.since, until: bounds?.until, timezone }, { period, timezone }, revision);
  return { ...rest, period: tag?.period, timezone: tag?.timezone };
}

// A plain inclusive range (`since` null pauses loading), e.g. the overview trend.
export function useRangeReport(since, until, revision = 0, timezone) {
  const { tag, ...rest } = useRange({ since, until, timezone }, { since, until, timezone }, revision);
  return { ...rest, data: tag?.timezone === timezone ? rest.data : null, since: tag?.since, until: tag?.until };
}

// A calendar selection: sorted local day keys (empty pauses loading). A
// contiguous run is one since/until range; gaps add the `days` filter.
export function selectionQuery(keys, contiguous) {
  if (!keys?.length) return { since: null, until: null, days: null };
  return { since: keys[0], until: keys.at(-1), days: contiguous || keys.length === 1 ? null : keys.join(',') };
}

export function useSelectionReport(keys, contiguous, revision = 0, timezone) {
  const query = selectionQuery(keys, contiguous);
  const key = keys?.join(',') ?? '';
  const { tag, ...rest } = useRange({ ...query, timezone }, { key, timezone }, revision);
  // Never expose another zone's numbers under the current one.
  return { ...rest, data: tag?.timezone === timezone ? rest.data : null, key: tag?.key ?? null };
}
