'use client';

import { useState } from 'react';
import { CalendarDays, LoaderCircle, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';
import { useWorkspace } from '@/lib/useWorkspace';
import { dayLabel, weekdayLabel } from '@/lib/i18n';
import { periodOf } from '@/lib/period';
import AppHeader from './AppHeader';
import Sidebar from './Sidebar';
import TodayDashboard from './TodayDashboard';
import Settings from './Settings';
import ReportActions from './ReportActions';
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
    <div className="skeleton-metrics">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" />)}</div>
    <div className="skel skeleton-chart" /><div className="skel skeleton-table" />
  </div>;
}

function ErrorState({ error, onRetry, tx }) {
  return <section className="state-card" role="alert"><TriangleAlert size={28} /><h2>{tx('errorTitle')}</h2><p>{error}</p>
    <button type="button" className="btn-primary" onClick={onRetry}><RefreshCw size={16} />{tx('retry')}</button></section>;
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

  return <div className={`app-shell${collapsed ? ' is-collapsed' : ''}`}>
    <a className="skip-link" href="#main-content">{tx('skipContent')}</a>
    <AppHeader view={view} onView={navigate} locale={locale} theme={w.theme} onTheme={w.onTheme} onLocale={w.onLocale} tx={tx} />
    <Sidebar view={view} onView={navigate} timezone={timezone} collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)} tx={tx} />
    <main className="main" id="main-content" tabIndex={-1}>
      <div className="workspace-content">
        <header className="workspace-head">
          <div className="workspace-title"><h1>{tx('title' + view)}</h1>
            <p>{tx(view + 'Description')}</p></div>
          {ready ? view === 'prices' ? <div className="price-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => { w.setPriceResetError(null); w.setPriceResetOpen(true); }}><RotateCcw size={15} />{tx('priceReset')}</button>
            <button type="button" className="btn-primary" disabled={busy || prices.status.offline} title={prices.status.offline ? tx('setupOffline') : undefined} onClick={w.onUpdatePrices}>
              {w.updatingPrices ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}{tx(w.updatingPrices ? 'updatingPrices' : 'updatePrices')}</button>
          </div> : <ReportActions tx={tx} loading={busy || w.reportBusy} refreshing={w.refreshing} onRefresh={w.onRefresh}
            exporting={w.exporting} onExport={w.onExport} canExport={w.canExport} settings={view === 'settings'} /> : null}
        </header>
        {ready && view === 'today' ? <div className="overview-toolbar no-export">
          <div className="agent-tabs" role="group" aria-label={tx('colAgent')}>
            <button type="button" className={!w.agent ? 'is-active' : ''} aria-pressed={!w.agent} onClick={() => w.onAgent('')}>{tx('filterAllAgents')}</button>
            {(report.data?.view?.availableClients ?? []).map((client) => <button key={client.id} type="button" className={w.agent === client.id ? 'is-active' : ''} aria-pressed={w.agent === client.id} onClick={() => w.onAgent(client.id)}>
              <i className="agent-dot" style={{ '--agent': `var(--agent-${client.id}, var(--text-3))` }} />{client.label}</button>)}
          </div>
          <div className="today-date"><CalendarDays size={15} />{today ? `${dayLabel(locale, today, true)} · ${weekdayLabel(locale, today)}` : '…'}</div>
        </div> : null}
        {ready && view === 'calendar' && w.activePeriod && today ? <ReportFilters period={w.activePeriod} today={today} agent={w.agent} clients={report.data?.view?.availableClients ?? []}
          onAgent={w.onAgent} onPeriod={w.onPeriod} onReset={() => { w.onAgent(''); w.onPeriod(periodOf(today, 'month')); }} tx={tx} /> : null}
        {w.reportView && (w.reportBusy || (report.error && w.hasData)) ? <div className="filter-status" role="status">
          {w.reportBusy ? <><LoaderCircle className="spin" size={13} />{tx('filterLoading')}</> : <>{tx('filterFailed')} <button type="button" className="filter-reset" onClick={() => void report.reload()}>{tx('retry')}</button></>}
        </div> : null}
        {content}
      </div>
    </main>
    {w.priceResetOpen ? <PriceReset tx={tx} busy={busy} resetting={prices.busy} error={w.priceResetError} onReset={w.onResetPrices} onClose={() => w.setPriceResetOpen(false)} /> : null}
    {w.databaseFile ? <DatabaseImport file={w.databaseFile} error={w.databaseError} busy={w.databaseBusy === 'import'} onImport={w.onImportDatabase} onClose={() => w.setDatabaseFile(null)} tx={tx} /> : null}
    <Toasts toasts={w.toasts.toasts} onDismiss={w.toasts.dismiss} tx={tx} />
  </div>;
}
