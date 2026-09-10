'use client';

// Stat row: four hairline-divided stat cells merged into the head of the
// Token activity (heatmap) card — total tokens (accent value, requests·
// sessions sub), reference cost (pricing coverage sub), cache hit rate
// (semantic green value), active days (start date sub). `Stat` is a single
// transparent cell; `kpiCards` maps the dashboard payload onto the four of
// them; `StatRow` renders the row.

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

export default function StatRow({ totals, cacheHitRate, activeDays, activityRange, tx }) {
  return (
    <div className="kpis kpis-inline" aria-label={tx('heroAria')}>
      {kpiCards({ totals, cacheHitRate, activeDays, activityRange, tx }).map((card) => (
        <Stat key={card.id} label={card.label} value={card.value} sub={card.sub} tone={card.tone} />
      ))}
    </div>
  );
}
