'use client';

// toksight dashboard — Editorial Paper (design-spec v8): warm paper ground,
// white hairline cards in a single content-sized column. Masthead → banners →
// tab bar → tab panels → footer. The tab bar splits the cards
// into three sections (design-spec §4): history (trend with its in-card
// range/mode controls, the Token-activity heatmap headed by the four-stat
// row, usage patterns), cost (period comparison with cost details,
// agent+model breakdown) and sessions (top-10 table).
// The active tab round-trips through ?tab= so views are linkable; manual URL
// deep links (?period=…&client=…) are still honored by the API and surfaced
// by the filter banner. Hover is a quiet color/background transition, no
// shadows/blur/gradients. Icons only mark actions and states; last-fetch
// time comes from generatedAt. This file only assembles data and picks the
// conditional branch; the pieces live in components/ (Shell, Cell, StatRow,
// TrendCell, AgentsPanel, ModelBars, Bars, Rhythm, SessionTable, StateCard,
// Skeleton, DashboardBanners, DashboardFooter).

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';
import Heatmap from '@/components/Heatmap';
import TrendCell from '@/components/TrendCell';
import AgentsPanel from '@/components/AgentsPanel';
import ModelBars from '@/components/ModelBars';
import { HourBars, MonthlyBars } from '@/components/Bars';
import CostDetails from '@/components/CostDetails';
import PeriodComparison from '@/components/PeriodComparison';
import Shell from '@/components/Shell';
import Cell from '@/components/Cell';
import StatRow from '@/components/Kpis';
import Rhythm from '@/components/Rhythm';
import SessionTable from '@/components/SessionTable';
import Skeleton from '@/components/Skeleton';
import DashboardBanners from '@/components/DashboardBanners';
import DashboardFooter from '@/components/DashboardFooter';
import { ErrorCard, EmptyCard } from '@/components/StateCard';
import { useDashboardData } from '@/lib/useDashboardData';
import { useLocale } from '@/lib/useLocale';
import { clientLabel } from '@/lib/clients';

const TABS = [
  { id: 'history', labelKey: 'tabHistory' },
  { id: 'cost', labelKey: 'tabCost' },
  { id: 'sessions', labelKey: 'tabSessions' },
];
const DEFAULT_TAB = 'history';

export default function Page() {
  const { data, error, refreshing, version, load } = useDashboardData();
  const [auto, setAuto] = useState(false);
  const [tab, setTab] = useState(DEFAULT_TAB);
  const { locale, setLocale, tx } = useLocale('docTitle');

  // Deep link: adopt a valid ?tab= once on mount; tab switches write back
  // with replaceState so the URL stays shareable without history spam.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('tab');
    if (TABS.some((t) => t.id === v)) setTab(v);
  }, []);

  const switchTab = (next) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === DEFAULT_TAB) url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

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
          <button className="btn" type="button" onClick={load} disabled={refreshing}>
            <RefreshCw size={14} strokeWidth={1.5} className={refreshing ? 'icon-spin' : undefined} aria-hidden="true" />
            {refreshing ? tx('refreshing') : tx('refresh')}
          </button>
        </>
      }
    >
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
        <EmptyCard tx={tx} filtered={filtered} />
        <DashboardFooter data={data} tx={tx} />
      </div>,
    );
  }

  return shell(
    <div className={fade}>
      <DashboardBanners data={data} tx={tx} />
      <nav className="dash-tabs" aria-label={tx('tabsAria')}>
        {TABS.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : undefined}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => switchTab(id)}
          >
            {tx(labelKey)}
          </button>
        ))}
      </nav>
      <div key={tab} className="tab-panels">
        {tab === 'history' && (
          <>
            <TrendCell data={data} agents={agents} locale={locale} tx={tx} />
            <Cell title={tx('heatTitle')} desc={data.selection ? tx('selectedCharts') : heatDesc}>
              <StatRow
                totals={totals}
                cacheHitRate={data.cacheHitRate}
                activeDays={data.activeDays ?? activeWindowDays}
                activityRange={data.activityRange}
                tx={tx}
              />
              <Heatmap heatmap={heatmap} locale={locale} />
            </Cell>
            <Cell title={tx('patternsTitle')} desc={tx('patternsDesc')} bodyClass="cell-trio">
              <section className="cell-part">
                <h3 className="cell-sub">{tx('hourTitle')}</h3>
                <HourBars hourly={data.hourly} locale={locale} />
              </section>
              <section className="cell-part">
                <h3 className="cell-sub">{tx('monthTitle')}</h3>
                <MonthlyBars monthly={data.monthly} locale={locale} />
              </section>
              <section className="cell-part">
                <h3 className="cell-sub">{tx('rhythmTitle')}</h3>
                <Rhythm streaks={data.streaks ?? {}} peakDay={data.peakDay} longest={data.longestSession} tx={tx} />
              </section>
            </Cell>
          </>
        )}
        {tab === 'cost' && (
          <>
            <PeriodComparison comparison={data.comparison} timezone={data.timezone} tx={tx} clientLabel={clientLabel}>
              <CostDetails coverage={data.costCoverage} pricing={data.pricing} tx={tx} />
            </PeriodComparison>
            <Cell title={tx('breakdownTitle')} desc={tx('breakdownDesc')} bodyClass="cell-split">
              <section className="cell-part">
                <h3 className="cell-sub">{tx('agentsTitle')}</h3>
                <AgentsPanel
                  agents={agents.map((a) => ({ ...a, label: clientLabel(a.id) }))}
                  models={data.models ?? []}
                  totals={{ totalTokens: totals.totalTokens, costUsd: totals.costUsd, cacheHitRate: data.cacheHitRate }}
                  locale={locale}
                />
              </section>
              <section className="cell-part">
                <h3 className="cell-sub">{tx('modelTitle')}</h3>
                <ModelBars models={data.models ?? []} totalTokens={totals.totalTokens} locale={locale} />
              </section>
            </Cell>
          </>
        )}
        {tab === 'sessions' && (
          <Cell title={tx('sessTitle')} desc={tx('sessDesc')}>
            <SessionTable rows={(data.topSessions ?? []).slice(0, 10)} tx={tx} />
            {(data.topSessions ?? []).length > 10 && (
              <details className="details">
                <summary>{tx('sessMore', { n: data.topSessions.length - 10 })}</summary>
                <SessionTable rows={data.topSessions.slice(10)} startIndex={10} tx={tx} />
              </details>
            )}
          </Cell>
        )}
      </div>
      <DashboardFooter data={data} tx={tx} />
    </div>,
  );
}
