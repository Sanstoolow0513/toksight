'use client';

// KPI strip: four white cards — total tokens (accent value, requests·sessions
// sub), reference cost (pricing coverage sub), cache hit rate (semantic green
// value), active days (start date sub). `Stat` is the single card; `kpiCards`
// maps the dashboard payload onto the four of them (one react-grid-layout
// item per card on wide screens, the `.kpis` grid wraps them in the narrow
// static fallback — see components/DashboardGrid.jsx).

import { fmtTokens, fmtCost, fmtPct, fmtDateOnly } from '@/lib/format';

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={tone ? `stat stat-${tone}` : 'stat'}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

export function kpiCards({ totals, cacheHitRate, activeDays, activityRange, tx }) {
  return [
    {
      id: 'kpi-tokens',
      label: tx('statTokens'),
      tone: 'lime',
      value: fmtTokens(totals.totalTokens),
      sub: tx('statTokensSub', { requests: totals.requests ?? 0, sessions: totals.sessions ?? 0 }),
    },
    {
      id: 'kpi-cost',
      label: tx('statCost'),
      value: fmtCost(totals.costUsd),
      sub: tx('costCoverage', { priced: totals.pricedRequests ?? 0, total: totals.requests ?? 0 }),
    },
    {
      id: 'kpi-cache',
      label: tx('statCache'),
      tone: 'green',
      value: fmtPct(cacheHitRate),
      sub: tx('statCacheSub', { tokens: fmtTokens(totals.cacheReadTokens) }),
    },
    {
      id: 'kpi-days',
      label: tx('statActiveDays'),
      value: activeDays,
      sub: activityRange?.firstAt ? tx('statActiveSince', { date: fmtDateOnly(activityRange.firstAt) }) : '—',
    },
  ];
}
