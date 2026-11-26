'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { periodBounds } from './period.js';

// Keep the last tagged response while reloading. A null URL pauses the
// request, and an aborted or superseded request cannot publish its result.
function useRequest(url, tag, revision) {
  const [state, setState] = useState({ data: null, tag: null, error: null, loading: false });
  const active = useRef(null);
  const sequence = useRef(0);
  const latest = useRef(tag);
  latest.current = tag;
  const tagKey = JSON.stringify(tag);

  const load = useCallback(async () => {
    if (!url) { setState((s) => ({ ...s, loading: false })); return; }
    const requested = latest.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const current = ++sequence.current;
    setState((s) => ({ ...s, error: null, loading: true }));
    try {
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (!controller.signal.aborted && current === sequence.current) setState({ data: body, tag: requested, error: null, loading: false });
    } catch (err) {
      if (!controller.signal.aborted && current === sequence.current) {
        setState((s) => ({ ...s, error: String(err?.message || err), loading: false }));
      }
    }
  }, [url, tagKey]);

  useEffect(() => {
    void load();
    return () => active.current?.abort();
  }, [load, revision]);

  return { ...state, reload: load };
}

function useRange({ since, until, days, agent, timezone }, tag, revision) {
  const query = new URLSearchParams({ period: 'custom', since, until });
  if (days) query.set('days', days);
  if (agent) query.set('client', agent);
  if (timezone) query.set('timezone', timezone);
  return useRequest(since ? `/api/data?${query}` : null, tag, revision);
}

export function useCalendarReport(enabled, today, revision, timezone) {
  const url = enabled ? `/api/calendar?${new URLSearchParams({ timezone })}` : null;
  const { tag, ...rest } = useRequest(url, { today, timezone }, revision);
  return { ...rest, data: tag?.today === today && tag?.timezone === timezone ? rest.data : null };
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
