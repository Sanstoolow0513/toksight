'use client';

import { useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useWorkspace } from '@/lib/useWorkspace';
import AppHeader from './AppHeader';
import Sidebar from './Sidebar';
import { Button } from './ui';
import TodayDashboard from './TodayDashboard';
import Settings from './Settings';
import PageActions from './PageActions';
import ReportFooter from './ReportFooter';
import CalendarView from './CalendarView';
import PriceSetup from './PriceSetup';
import PriceCatalog from './PriceCatalog';
import PriceReset from './PriceReset';
import DatabaseImport from './DatabaseImport';
import { GitHubRestore } from './GitHubBackup';
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
    locale={locale} theme={w.theme} onTheme={w.onTheme} onLocale={w.onLocale} loading={busy} databaseBusy={w.databaseBusy} onImportDatabase={w.onSelectDatabase} onExportDatabase={w.onExportDatabase}
    backup={w.backup} onBackupSave={w.onBackupSave} onBackupUpload={w.onBackupUpload} onBackupRestore={w.onBackupConfirm} />;
  else if (!w.hasData && w.current.error) content = <ErrorState tx={tx} error={w.current.error} onRetry={() => void w.current.reload()} />;
  else if (!w.hasData) content = <Skeleton tx={tx} />;
  else content = <div ref={w.reportRef} className={`report ${view}-report${w.reportBusy ? ' is-loading' : ''}${w.current.error ? ' is-stale' : ''}`} aria-busy={w.reportBusy}>
    {view === 'today' ? <TodayDashboard data={data} day={w.shown.since} today={today} trend={w.trend} quotaRevision={w.refreshRevision} {...w.shared} open={w.openAgents} onToggle={w.onToggleAgent} onCalendar={() => navigate('calendar')} />
      : <CalendarView data={data} today={today} start={w.calendarStart} selected={w.selected} anchor={w.anchor} zoom={w.calendarZoom} onZoom={w.onCalendarZoom}
        onSelect={w.onSelect} report={w.selectionReport} agentLabel={w.shared.agentLabel} locale={locale} tx={tx} />}
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
      <div className={`workspace-content${ready && view === 'prices' ? ' is-prices' : ''}${ready && view === 'calendar' ? ' is-calendar' : ''}`}>
        {view === 'today' && (w.reportBusy || (report.error && w.hasData)) ? <div className="filter-status" role="status">
          {w.reportBusy ? <><span className="status-led" aria-hidden="true" />{tx('filterLoading')}</> : <>{tx('filterFailed')} <Button variant="text" onClick={() => void report.reload()}>{tx('retry')}</Button></>}
        </div> : null}
        {content}
      </div>
    </main>
    {w.priceResetOpen ? <PriceReset tx={tx} busy={busy} resetting={prices.busy} error={w.priceResetError} onReset={w.onResetPrices} onClose={() => w.setPriceResetOpen(false)} /> : null}
    {w.databaseFile ? <DatabaseImport file={w.databaseFile} error={w.databaseError} busy={w.databaseBusy === 'import'} onImport={w.onImportDatabase} onClose={() => w.setDatabaseFile(null)} tx={tx} /> : null}
    {w.backup.confirming && w.backup.status ? <GitHubRestore status={w.backup.status} busy={w.backup.busy === 'restore'} error={w.backup.error?.action === 'restore' ? w.backup.error : null}
      onRestore={w.onBackupRestore} onClose={w.onBackupCancel} tx={tx} timezone={timezone} /> : null}
    <Toasts toasts={w.toasts.toasts} onDismiss={w.toasts.dismiss} tx={tx} />
  </div>;
}
