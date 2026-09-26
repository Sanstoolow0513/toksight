'use client';

// toksight report: a centred column on a dot grid — KPIs, two reorderable
// chapter cards (heatmap · agent table, with each agent's models nested) and a footer.
// Everything inside `.report` is what "Export image" captures. Double-clicking
// the heatmap card opens it over the page with the picked day in full; the
// report underneath stays put and the opened card never enters the image.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Inbox, RefreshCw, TriangleAlert } from 'lucide-react';
import Toolbar from '@/components/Toolbar';
import ReportActions from '@/components/ReportActions';
import DatabaseImport from '@/components/DatabaseImport';
import SortableCards from '@/components/SortableCards';
import HeatmapCard from '@/components/HeatmapCard';
import AgentsCard from '@/components/AgentsCard';
import ExpandedHeatmap from '@/components/ExpandedHeatmap';
import Kpis from '@/components/Kpis';
import BrandMark from '@/components/BrandMark';
import Toasts, { useToasts } from '@/components/Toasts';
import { useDayReport, useReport } from '@/lib/useReport';
import { currentPeriod, dayKey, dayNav, inPeriod, periodKey, periodNav, periodOf, shiftDay, shiftPeriod, withMode } from '@/lib/period';
import { fmtDateTime, fmtInt } from '@/lib/format';
import { DEFAULT_LOCALE, periodLabel, t } from '@/lib/i18n';
import { exportReportImage } from '@/lib/exportImage';
import * as prefs from '@/lib/prefs';
import { coded } from '@/components/Coded';

function StateCard({ icon, title, children }) {
  return (
    <section className="state-card">
      <div className="state-icon">{icon}</div>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="report" aria-busy="true">
      <div className="skel skel-kpis" />
      {[320, 420].map((h) => (
        <div key={h} className="skel skel-card" style={{ height: h }} />
      ))}
    </div>
  );
}

export default function Page() {
  const [locale, setLocale] = useState(DEFAULT_LOCALE);
  const [theme, setTheme] = useState(null);
  const [period, setPeriod] = useState(null);
  const [today, setToday] = useState(null);
  const [order, setOrder] = useState(prefs.CARD_IDS);
  const [agentSort, setAgentSort] = useState('tokens');
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [priceUpdating, setPriceUpdating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [databaseBusy, setDatabaseBusy] = useState(null);
  const [databaseFile, setDatabaseFile] = useState(null);
  const [databaseError, setDatabaseError] = useState(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  // null, 'open', or 'closing' while the sheet folds back into the card.
  const [sheet, setSheet] = useState(null);
  const reportRef = useRef(null);
  const heatRef = useRef(null);
  const toasts = useToasts();
  const { push: pushToast } = toasts;
  const report = useReport(period, refreshRevision);
  const dayReport = useDayReport(selectedDay, refreshRevision);
  const { data } = report;
  const shown = report.period;

  // With a report on screen a failed reload keeps it and only raises a toast;
  // collection warnings pop up again only when their content changes.
  const staleError = data ? report.error : null;
  useEffect(() => {
    if (staleError) pushToast({ key: 'report-error', tone: 'error', message: ['errorBody', { error: staleError }] });
  }, [staleError, pushToast]);
  const warningText = data?.warnings?.length ? data.warnings.join('\n') : '';
  const lastWarningText = useRef('');
  useEffect(() => {
    if (!warningText || warningText === lastWarningText.current) return;
    lastWarningText.current = warningText;
    const items = warningText.split('\n');
    pushToast({ key: 'warnings', tone: 'warn', message: ['warnings', { n: items.length }], details: { items } });
  }, [warningText, pushToast]);

  useEffect(() => {
    const now = new Date();
    setLocale(prefs.readLocale());
    setTheme(prefs.readTheme());
    setOrder(prefs.readOrder());
    setAgentSort(prefs.readAgentSort());
    setToday(dayKey(now));
    setPeriod(currentPeriod(prefs.readMode(), now));
  }, []);

  useEffect(() => {
    if (!theme) return undefined;
    const apply = () => {
      document.documentElement.dataset.theme = prefs.resolveTheme(theme);
    };
    apply();
    if (theme !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t(locale, 'docTitle');
  }, [locale]);

  const tx = useCallback((key, vars) => t(locale, key, vars), [locale]);

  const labels = useMemo(() => new Map((data?.view?.availableClients ?? []).map((c) => [c.id, c.label])), [data]);
  const agentLabel = useCallback((id) => labels.get(id) ?? id, [labels]);

  const firstAt = data?.scopeRange?.firstAt;
  const firstDay = firstAt != null ? dayKey(new Date(firstAt)) : null;
  const nav = period && data ? periodNav(period, { firstDay, today }) : { canPrev: false, canNext: false };
  const selectedNav = selectedDay ? dayNav(selectedDay, { firstDay, today }) : { canPrev: false, canNext: false };

  const onMode = (mode) => {
    prefs.writeMode(mode);
    setPeriod((p) => withMode(p, mode, today));
  };
  const onTheme = (value) => {
    prefs.writeTheme(value);
    setTheme(value);
  };
  const onLocale = (value) => {
    prefs.writeLocale(value);
    setLocale(value);
  };
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/refresh', { method: 'POST', cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setToday(dayKey(new Date()));
      setRefreshRevision((n) => n + 1);
    } catch (err) {
      pushToast({ key: 'refresh', tone: 'error', message: ['refreshFailed', { error: String(err?.message || err) }] });
    } finally {
      setRefreshing(false);
    }
  };
  const onUpdatePrices = async () => {
    setPriceUpdating(true);
    try {
      const res = await fetch('/api/prices/update', { method: 'POST', cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const warnings = body.warnings ?? [];
      pushToast(warnings.length
        ? { key: 'prices', tone: 'warn', message: ['priceUpdateWarnings', { count: warnings.length }], details: { items: warnings } }
        : { key: 'prices', tone: 'success', message: ['priceUpdateSuccess'] });
      setRefreshRevision((n) => n + 1);
    } catch (err) {
      pushToast({ key: 'prices', tone: 'error', message: ['priceUpdateFailed', { error: String(err?.message || err) }] });
    } finally {
      setPriceUpdating(false);
    }
  };
  const onImportCursor = async (file) => {
    setImporting(true);
    try {
      const res = await fetch('/api/import/cursor', {
        method: 'POST', headers: { 'content-type': 'text/csv; charset=utf-8' },
        body: file, cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const warnings = body.warnings ?? [];
      pushToast({
        key: 'import',
        tone: warnings.length ? 'warn' : 'success',
        message: ['importSuccess', {
          imported: fmtInt(body.imported), updated: fmtInt(body.updated),
          duplicates: fmtInt(body.duplicates), skipped: fmtInt(body.skipped + body.zeroUsage),
        }],
        details: { summary: ['importWarnings', { n: warnings.length }], items: warnings },
      });
      if (body.latestAt != null) {
        setPeriod((p) => currentPeriod(p?.mode ?? 'month', new Date(Math.min(body.latestAt, Date.now()))));
      }
      setRefreshRevision((n) => n + 1);
    } catch (err) {
      pushToast({ key: 'import', tone: 'error', message: ['importFailed', { error: String(err?.message || err) }] });
    } finally {
      setImporting(false);
    }
  };
  const onSelectDatabase = (file) => {
    setDatabaseError(null);
    if (file.size > 256 * 1024 * 1024) {
      pushToast({ key: 'database', tone: 'error', message: ['databaseTooLarge'] });
      return;
    }
    setDatabaseFile(file);
  };
  const onImportDatabase = async () => {
    setDatabaseBusy('import');
    setDatabaseError(null);
    try {
      const res = await fetch('/api/import/db', { method: 'POST', headers: { 'content-type': 'application/vnd.sqlite3' }, body: databaseFile, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.code === 'BAD_DATABASE' ? tx('databaseInvalid') : body.code === 'DATABASE_TOO_LARGE' ? tx('databaseTooLarge') : body.error || `HTTP ${res.status}`);
      pushToast({ key: 'database', tone: 'success', message: ['databaseImportSuccess', {
        imported: fmtInt(body.imported), updated: fmtInt(body.updated), duplicates: fmtInt(body.duplicates),
      }] });
      setDatabaseFile(null);
      if (body.latestAt != null) setPeriod((p) => currentPeriod(p?.mode ?? 'month', new Date(Math.min(body.latestAt, Date.now()))));
      setRefreshRevision((n) => n + 1);
    } catch (err) {
      setDatabaseError(String(err?.message || err));
    } finally { setDatabaseBusy(null); }
  };
  const onExportDatabase = async () => {
    setDatabaseBusy('export');
    try {
      const res = await fetch('/api/export/db', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `toksight-backup-${dayKey(new Date())}-${Date.now()}.sqlite`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      pushToast({ key: 'database', tone: 'success', message: ['databaseExportSuccess'] });
    } catch (err) {
      pushToast({ key: 'database', tone: 'error', message: ['databaseExportFailed', { error: String(err?.message || err) }] });
    } finally { setDatabaseBusy(null); }
  };
  // On the report card a click marks a day and clicking it again clears the
  // mark; inside the opened card a click always switches to the day.
  const onSelectDay = useCallback((date) => setSelectedDay((d) => (d === date ? null : date)), []);
  const onPickDay = useCallback((date) => setSelectedDay(date), []);
  const onExpand = useCallback((date) => {
    setSelectedDay(date);
    setSheet('open');
  }, []);
  const onCollapse = useCallback(() => setSheet((s) => (s ? 'closing' : s)), []);
  const onClosed = useCallback(() => setSheet(null), []);
  // Stepping past the period's edge takes the report along, so the opened
  // calendar always shows the day.
  const onStepDay = (delta) => {
    if (!selectedDay) return;
    const next = shiftDay(selectedDay, delta);
    setSelectedDay(next);
    if (period && !inPeriod(next, period)) setPeriod(periodOf(next, period.mode));
  };
  const onAgentSort = useCallback((value) => {
    prefs.writeAgentSort(value);
    setAgentSort(value);
  }, []);
  const onReorder = (next) => {
    prefs.writeOrder(next);
    setOrder(next);
  };
  const onExport = async () => {
    setExporting(true);
    try {
      await exportReportImage(reportRef.current, `toksight-${periodKey(shown)}.png`);
    } catch (err) {
      pushToast({ key: 'export', tone: 'error', message: ['exportFailed', { error: String(err?.message || err) }] });
    } finally {
      setExporting(false);
    }
  };

  const hasData = Boolean(data && firstAt != null);

  let content;
  if (!data && report.error) {
    content = (
      <StateCard icon={<TriangleAlert size={22} strokeWidth={1.8} aria-hidden="true" />} title={tx('errorTitle')}>
        <p>{coded(tx('errorBody', { error: report.error }))}</p>
        <p>{coded(tx('errorHint'))}</p>
        <button type="button" className="btn-secondary" onClick={() => void report.reload()}>
          <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
          {tx('retry')}
        </button>
      </StateCard>
    );
  } else if (!data || !shown) {
    content = <Skeleton />;
  } else if (!hasData) {
    content = (
      <StateCard icon={<Inbox size={22} strokeWidth={1.8} aria-hidden="true" />} title={tx('emptyTitle')}>
        <p>{coded(tx('emptyBody'))}</p>
      </StateCard>
    );
  } else {
    const unpriced = data.pricing?.unpricedModels ?? [];
    const cursorUnpriced = (data.clients?.cursor?.pricedRequests ?? 0) < (data.clients?.cursor?.requests ?? 0);
    const cardProps = { data, period: shown, locale, tx, agentLabel };

    content = (
      <div ref={reportRef} className={report.loading ? 'report is-loading' : 'report'}>
        <section className="hero">
          <h1 className="visually-hidden">{tx('eyebrow')} · {periodLabel(locale, shown)}</h1>
          <Kpis data={data} tx={tx} />
        </section>

        <SortableCards order={order} onReorder={onReorder} handleLabel={tx('dragHandle')}>
          {(id, { handleProps }) => {
            const shared = { ...cardProps, handleProps };
            if (id === 'heatmap') {
              return (
                <HeatmapCard
                  {...shared}
                  cardRef={heatRef}
                  today={today}
                  selected={selectedDay}
                  onSelect={onSelectDay}
                  onExpand={onExpand}
                  sheeted={Boolean(sheet)}
                />
              );
            }
            return <AgentsCard {...shared} sortBy={agentSort} onSort={onAgentSort} />;
          }}
        </SortableCards>

        <footer className="report-foot">
          <span className="foot-brand">
            <BrandMark size={14} />
            toksight v{data.version}
          </span>
          <span>{tx('footRefreshed', { time: fmtDateTime(data.snapshot?.refreshedAt ?? data.generatedAt) })}</span>
          {data.pricing?.updates?.litellm?.fetchedAt ? <span>{tx('footPriceUpdated', { source: 'LiteLLM', time: fmtDateTime(data.pricing.updates.litellm.fetchedAt) })}</span> : null}
          {data.pricing?.updates?.cursor?.fetchedAt ? <span>{tx('footPriceUpdated', { source: 'Cursor', time: fmtDateTime(data.pricing.updates.cursor.fetchedAt) })}</span> : null}
          {data.timezone ? <span>{tx('footTimezone', { tz: data.timezone })}</span> : null}
          <span>{tx(data.costCoverage?.sources?.cursor?.requests ? 'footEstimateCursor' : cursorUnpriced ? 'footEstimateCursorUnpriced' : 'footEstimate')}</span>
          {data.costCoverage?.sources?.cursor?.requests ? <a href="https://cursor.com/docs/models-and-pricing" target="_blank" rel="noreferrer">{tx('footCursorSource')}</a> : null}
          <span>{tx('footLocal')}</span>
          {unpriced.length ? <span className="foot-unpriced">{tx('footUnpriced', { models: unpriced.join(', ') })}</span> : null}
        </footer>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-body" inert={Boolean(sheet)}>
        <Toolbar
          locale={locale}
          tx={tx}
          period={period}
          nav={nav}
          onMode={onMode}
          onShift={(delta) => setPeriod((p) => shiftPeriod(p, delta))}
          theme={theme}
          onTheme={onTheme}
          onLocale={onLocale}
          loading={report.loading || refreshing || priceUpdating || importing || Boolean(databaseBusy)}
          onRefresh={onRefresh}
        />
        <main className="main">
          <ReportActions
            tx={tx}
            loading={report.loading || refreshing || priceUpdating || importing || Boolean(databaseBusy)}
            databaseBusy={databaseBusy}
            onImportDatabase={onSelectDatabase}
            onExportDatabase={onExportDatabase}
            priceUpdating={priceUpdating}
            onUpdatePrices={onUpdatePrices}
            importing={importing}
            onImportCursor={onImportCursor}
            exporting={exporting}
            onExport={onExport}
            canExport={hasData && !report.loading}
          />
          {content}
        </main>
      </div>
      {sheet && hasData ? (
        <ExpandedHeatmap
          anchorRef={heatRef}
          closing={sheet === 'closing'}
          onCollapse={onCollapse}
          onClosed={onClosed}
          data={data}
          period={shown}
          loading={report.loading}
          today={today}
          day={selectedDay}
          onPick={onPickDay}
          dayReport={dayReport}
          dayNav={selectedNav}
          onStep={onStepDay}
          sortBy={agentSort}
          onSort={onAgentSort}
          locale={locale}
          tx={tx}
          agentLabel={agentLabel}
        />
      ) : null}
      {databaseFile ? <DatabaseImport file={databaseFile} error={databaseError} busy={databaseBusy === 'import'} onImport={onImportDatabase} onClose={() => setDatabaseFile(null)} tx={tx} /> : null}
      <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} tx={tx} />
    </div>
  );
}
