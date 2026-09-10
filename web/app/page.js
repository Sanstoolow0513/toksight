'use client';

// toksight dashboard — Editorial Paper (design-spec v7): warm paper ground,
// white hairline cards. Masthead → banners → draggable/resizable card grid
// (DashboardGrid: KPI ×4, comparison, cost, trend, heatmap, agent/model,
// hour/month/pace, sessions; static .sheet stream below 900px) → footer.
// Hover is a quiet color/background transition, no shadows/blur/gradients.
// Icons only mark actions and states; last-fetch time comes from
// generatedAt. This file only assembles data and picks the conditional
// branch; the pieces live in components/ (Shell, Cell, TrendCell, Kpis,
// Rhythm, SessionTable, StateCard, Skeleton, DashboardBanners,
// DashboardGrid, DashboardFooter).

import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';
import Heatmap from '@/components/Heatmap';
import TrendCell from '@/components/TrendCell';
import AgentsPanel from '@/components/AgentsPanel';
import ModelBars from '@/components/ModelBars';
import { HourBars, MonthlyBars } from '@/components/Bars';
import DashboardFilters from '@/components/DashboardFilters';
import CostDetails from '@/components/CostDetails';
import PeriodComparison from '@/components/PeriodComparison';
import Shell from '@/components/Shell';
import Cell from '@/components/Cell';
import DashboardGrid from '@/components/DashboardGrid';
import { Stat, kpiCards } from '@/components/Kpis';
import Rhythm from '@/components/Rhythm';
import SessionTable from '@/components/SessionTable';
import Skeleton from '@/components/Skeleton';
import DashboardBanners from '@/components/DashboardBanners';
import DashboardFooter from '@/components/DashboardFooter';
import { ErrorCard, EmptyCard } from '@/components/StateCard';
import { useDashboardData } from '@/lib/useDashboardData';
import { useLocale } from '@/lib/useLocale';
import { clientLabel } from '@/lib/clients';

export default function Page() {
  const { data, view, error, refreshing, version, load, query, applyQuery } = useDashboardData();
  const [auto, setAuto] = useState(false);
  const { locale, setLocale, tx } = useLocale('docTitle');
  const gridResetRef = useRef(null);

  useEffect(() => {
    if (!auto) return undefined;
    const id = setInterval(() => load({ silent: true }), 30_000);
    return () => clearInterval(id);
  }, [auto, load]);

  const agents = useMemo(() => {
    if (!data?.clients) return [];
    return Object.entries(data.clients)
      .map(([id, row]) => ({ id, ...row }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }, [data]);

  // Alternating fade-a/fade-b replays the 200ms content fade on every
  // non-silent load without remounting the subtree.
  const fade = version % 2 ? 'fade-b' : 'fade-a';

  const shell = (body) => (
    <Shell
      active="dashboard"
      tx={tx}
      locale={locale}
      setLocale={setLocale}
      meta={data ? <span className="fetch-meta">{tx('live', { time: fmtDateTime(data.generatedAt) })}</span> : null}
      actions={
        <>
          <label className="auto-label">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            {tx('autoRefresh')}
          </label>
          <button className="btn" type="button" title={tx('layoutReset')} onClick={() => gridResetRef.current?.()}>
            <RotateCcw size={16} strokeWidth={1.5} aria-hidden="true" />
            {tx('layoutReset')}
          </button>
          <button className="btn" type="button" onClick={load} disabled={refreshing}>
            <RefreshCw size={14} strokeWidth={1.5} className={refreshing ? 'icon-spin' : undefined} aria-hidden="true" />
            {refreshing ? tx('refreshing') : tx('refresh')}
          </button>
        </>
      }
    >
      <DashboardFilters query={query} view={view} tx={tx} loading={refreshing} onApply={applyQuery} />
      {error && data && <div className="banner error" role="alert">{tx('errorFail', { error })}</div>}
      {body}
    </Shell>
  );

  if (error && !data) return shell(<ErrorCard error={error} tx={tx} onRetry={load} />);
  if (!data) return shell(<Skeleton />);

  const totals = data.totals ?? {};
  const heatmap = data.selection?.heatmap ?? data.heatmap;
  const activeWindowDays = (heatmap?.days ?? []).filter((d) => d.tokens > 0).length;
  const filtered = Boolean(data.clientsFilter?.length || data.range?.since != null || data.range?.until != null);
  const heatDesc = [tx('heatDesc', { weeks: heatmap?.weeks ?? 53 }), activeWindowDays ? tx('heatActive', { n: activeWindowDays }) : null]
    .filter(Boolean)
    .join(' · ');

  if (totals.requests === 0) {
    return shell(
      <div className={fade}>
        <DashboardBanners data={data} tx={tx} />
        <PeriodComparison comparison={data.comparison} timezone={data.timezone} tx={tx} clientLabel={clientLabel} />
        <EmptyCard tx={tx} filtered={Boolean(query) || filtered} />
        <DashboardFooter data={data} tx={tx} />
      </div>,
    );
  }

  const items = {};
  for (const card of kpiCards({ totals, cacheHitRate: data.cacheHitRate, activeDays: data.activeDays ?? activeWindowDays, activityRange: data.activityRange, tx })) {
    items[card.id] = <Stat label={card.label} value={card.value} sub={card.sub} tone={card.tone} />;
  }
  items.comparison = <PeriodComparison comparison={data.comparison} timezone={data.timezone} tx={tx} clientLabel={clientLabel} />;
  items.cost = <CostDetails coverage={data.costCoverage} pricing={data.pricing} tx={tx} />;
  items.trend = <TrendCell data={data} agents={agents} locale={locale} tx={tx} />;
  items.heatmap = (
    <Cell title={tx('heatTitle')} desc={data.selection ? tx('selectedCharts') : heatDesc}>
      <Heatmap heatmap={heatmap} locale={locale} />
    </Cell>
  );
  items.agents = (
    <Cell title={tx('agentsTitle')} desc={tx('agentsDesc')} span={5}>
      <AgentsPanel
        agents={agents.map((a) => ({ ...a, label: clientLabel(a.id) }))}
        models={data.models ?? []}
        totals={{ totalTokens: totals.totalTokens, costUsd: totals.costUsd, cacheHitRate: data.cacheHitRate }}
        locale={locale}
      />
    </Cell>
  );
  items.models = (
    <Cell title={tx('modelTitle')} desc={tx('modelDesc')} span={7}>
      <ModelBars models={data.models ?? []} totalTokens={totals.totalTokens} locale={locale} />
    </Cell>
  );
  items.hour = (
    <Cell title={tx('hourTitle')} desc={tx('hourDesc')} span={4}>
      <HourBars hourly={data.hourly} locale={locale} />
    </Cell>
  );
  items.month = (
    <Cell title={tx('monthTitle')} desc={tx('monthFiltered')} span={4}>
      <MonthlyBars monthly={data.monthly} locale={locale} />
    </Cell>
  );
  items.rhythm = (
    <Cell title={tx('rhythmTitle')} desc={tx('rhythmDesc')} span={4}>
      <Rhythm streaks={data.streaks ?? {}} peakDay={data.peakDay} longest={data.longestSession} tx={tx} />
    </Cell>
  );
  items.sessions = (
    <Cell title={tx('sessTitle')} desc={tx('sessDesc')}>
      <SessionTable rows={(data.topSessions ?? []).slice(0, 10)} tx={tx} />
    </Cell>
  );

  return shell(
    <div className={fade}>
      <DashboardBanners data={data} tx={tx} />
      <DashboardGrid items={items} tx={tx} resetRef={gridResetRef} />
      <DashboardFooter data={data} tx={tx} />
    </div>,
  );
}
