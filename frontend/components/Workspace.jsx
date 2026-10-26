'use client';

import { useState } from 'react';
import { CalendarDays, RefreshCw, TriangleAlert } from 'lucide-react';
import { useWorkspace } from '@/lib/useWorkspace';
import { dayLabel, weekdayLabel } from '@/lib/i18n';
import { periodOf } from '@/lib/period';
import AppHeader from './AppHeader';
import Sidebar from './Sidebar';
import { Button, Segmented } from './ui';
import { AgentDot } from './Marks';
import TodayDashboard from './TodayDashboard';
import Settings from './Settings';
import PageActions from './PageActions';
import ReportFilters from './ReportFilters';
import ReportFooter from './ReportFooter';
import CalendarView from './CalendarView';
import PriceSetup from './PriceSetup';
import PriceCatalog from './PriceCatalog';
import PriceReset from './PriceReset';
import DatabaseImport from './DatabaseImport';
import Toasts from './Toasts';

function Skeleton({ tx }) {
  return <div className="loading-workspace" role="status" aria-label={tx('filterLoading')} aria-busy="true">
    <div className="skel skeleton-metrics" />
    <div className="skel skeleton-chart" /><div className="skel skeleton-table" />
  </div>;
}

function ErrorState({ error, onRetry, tx }) {
  return <section className="state-card plate" role="alert"><TriangleAlert size={28} aria-hidden="true" /><h2>{tx('errorTitle')}</h2><p>{error}</p>
    <Button variant="primary" icon={<RefreshCw size={15} />} onClick={onRetry}>{tx('retry')}</Button></section>;
}

export default function Workspace() {
  const w = useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  const { prices, view, tx, data, report, today, locale, timezone, busy } = w;
  const navigate = (next) => { w.setView(next); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const ready = prices.status?.completed;
  let content;
  if (prices.status && !ready) content = <PriceSetup tx={tx} status={prices.status} busy={prices.busy} error={prices.error} onSetup={w.onSetup} />;
  else if (!prices.status && prices.error) content = <ErrorState tx={tx} error={prices.error} onRetry={() => void prices.reload()} />;
  else if (!prices.status) content = <Skeleton tx={tx} />;
  else if (view === 'prices') content = <PriceCatalog tx={tx} locale={locale} timezone={timezone} status={prices.status} busy={busy} error={prices.error}
    revision={`${w.refreshRevision}:${prices.status.observedAt}`} onSources={(selectedSources) => void w.onSetup({ selectedSources, offline: prices.status.offline })}
    onAutoUpdate={(autoUpdate) => void w.onSetup({ offline: true, autoUpdate })} />;
  else if (view === 'settings') content = <Settings tx={tx} timezone={timezone} timezonePref={w.timezonePref} systemZone={w.systemZone} onTimezone={w.onTimezone} now={w.now}
    locale={locale} theme={w.theme} onTheme={w.onTheme} onLocale={w.onLocale} loading={busy} databaseBusy={w.databaseBusy} onImportDatabase={w.onSelectDatabase} onExportDatabase={w.onExportDatabase} />;
  else if (!w.hasData && report.error) content = <ErrorState tx={tx} error={report.error} onRetry={() => void report.reload()} />;
  else if (!w.hasData) content = <Skeleton tx={tx} />;
  else content = <div ref={w.reportRef} className={`report ${view}-report${w.reportBusy ? ' is-loading' : ''}${report.error ? ' is-stale' : ''}`} aria-busy={w.reportBusy}>
    <div className="report-context"><span>{view === 'today' ? dayLabel(locale, w.shown.since, true) : tx('rangeSummary')}</span>
      <span>{report.agent ? w.shared.agentLabel(report.agent) : tx('filterAllAgents')} · {data.timezone}</span></div>
    {view === 'today' ? <TodayDashboard data={data} day={w.shown.since} quotaRevision={w.refreshRevision} {...w.shared} open={w.openAgents} onToggle={w.onToggleAgent} onCalendar={() => navigate('calendar')} />
      : <CalendarView {...w.shared} data={data} period={w.shown} today={today} firstDay={w.firstDay} day={w.calendarDay} onPick={w.setSelectedDay}
        dayReport={w.dayReport} dayNav={w.selectedNav} onStep={w.onStepDay} onPeriod={w.onPeriod} />}
    <ReportFooter data={data} tx={tx} />
  </div>;

  const actions = !ready ? null : <PageActions view={view} tx={tx} loading={busy || w.reportBusy} refreshing={w.refreshing} onRefresh={w.onRefresh}
    exporting={w.exporting} onExport={w.onExport} canExport={w.canExport}
    prices={{ busy, offline: prices.status.offline, updating: w.updatingPrices, onUpdate: w.onUpdatePrices, onReset: () => { w.setPriceResetError(null); w.setPriceResetOpen(true); } }} />;

  return <div className={`app-shell${collapsed ? ' is-collapsed' : ''}`}>
    <a className="skip-link" href="#main-content">{tx('skipContent')}</a>
    <AppHeader view={view} onView={navigate} locale={locale} theme={w.theme} onTheme={w.onTheme} onLocale={w.onLocale} tx={tx} actions={actions} />
    <Sidebar view={view} onView={navigate} timezone={timezone} collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)} tx={tx} />
    <main className="main" id="main-content" tabIndex={-1}>
      <div className="workspace-content">
        {ready && view === 'today' ? <div className="overview-toolbar no-export">
          <Segmented size="sm" label={tx('colAgent')} value={w.agent || ''} onChange={(id) => w.onAgent(id)} wrap className="agent-tabs" options={[
            { value: '', label: tx('filterAllAgents') },
            ...(report.data?.view?.availableClients ?? []).map((client) => ({ value: client.id, label: client.label, icon: <AgentDot id={client.id} /> })),
          ]} />
          <div className="today-date"><CalendarDays size={14} aria-hidden="true" />{today ? `${dayLabel(locale, today, true)} · ${weekdayLabel(locale, today)}` : '…'}</div>
        </div> : null}
        {ready && view === 'calendar' && w.activePeriod && today ? <ReportFilters period={w.activePeriod} today={today} agent={w.agent} clients={report.data?.view?.availableClients ?? []}
          onAgent={w.onAgent} onPeriod={w.onPeriod} onReset={() => { w.onAgent(''); w.onPeriod(periodOf(today, 'month')); }} tx={tx} /> : null}
        {w.reportView && (w.reportBusy || (report.error && w.hasData)) ? <div className="filter-status" role="status">
          {w.reportBusy ? <><span className="status-led" aria-hidden="true" />{tx('filterLoading')}</> : <>{tx('filterFailed')} <Button variant="text" onClick={() => void report.reload()}>{tx('retry')}</Button></>}
        </div> : null}
        {content}
      </div>
    </main>
    {w.priceResetOpen ? <PriceReset tx={tx} busy={busy} resetting={prices.busy} error={w.priceResetError} onReset={w.onResetPrices} onClose={() => w.setPriceResetOpen(false)} /> : null}
    {w.databaseFile ? <DatabaseImport file={w.databaseFile} error={w.databaseError} busy={w.databaseBusy === 'import'} onImport={w.onImportDatabase} onClose={() => w.setDatabaseFile(null)} tx={tx} /> : null}
    <Toasts toasts={w.toasts.toasts} onDismiss={w.toasts.dismiss} tx={tx} />
  </div>;
}
