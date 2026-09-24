'use client';

// toksight report: a centred column on a dot grid — hero (period + KPIs),
// three reorderable chapter cards (heatmap · agents · models) and a footer.
// Everything inside `.report` is what "Export image" captures. Clicking a
// heatmap day opens the day card beside the column (the pair re-centres on
// wide screens; it floats over the page on narrow ones); the card never
// enters the exported image.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, Inbox, RefreshCw, TriangleAlert } from 'lucide-react';
import Toolbar from '@/components/Toolbar';
import SortableCards from '@/components/SortableCards';
import HeatmapCard from '@/components/HeatmapCard';
import AgentsCard from '@/components/AgentsCard';
import ModelsCard from '@/components/ModelsCard';
import DayPanel from '@/components/DayPanel';
import BrandMark from '@/components/BrandMark';
import { useDayReport, useReport } from '@/lib/useReport';
import { currentPeriod, dayKey, dayNav, periodBounds, periodKey, periodNav, shiftDay, shiftPeriod, withMode } from '@/lib/period';
import { fmtCost, fmtDateTime, fmtInt, fmtPct, fmtTokens } from '@/lib/format';
import { DEFAULT_LOCALE, dayLabel, periodLabel, t } from '@/lib/i18n';
import { exportReportImage } from '@/lib/exportImage';
import * as prefs from '@/lib/prefs';
import { coded } from '@/components/Coded';

function Kpi({ label, value, sub }) {
  return (
    <div className="kpi">
      <dt>{label}</dt>
      <dd>
        <span className="kpi-value">{value}</span>
        <span className="kpi-sub">{sub}</span>
      </dd>
    </div>
  );
}

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
      <div className="hero">
        <div className="skel" style={{ width: 180, height: 14 }} />
        <div className="skel" style={{ width: 280, height: 44, marginTop: 14 }} />
        <div className="skel skel-kpis" />
      </div>
      {[320, 260, 300].map((h) => (
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
  const [metrics, setMetrics] = useState(() => Object.fromEntries(prefs.CARD_IDS.map((id) => [id, 'tokens'])));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [dayMetric, setDayMetric] = useState('tokens');
  const reportRef = useRef(null);
  const report = useReport(period, refreshRevision);
  const dayReport = useDayReport(selectedDay, refreshRevision);
  const { data } = report;
  const shown = report.period;

  useEffect(() => {
    const now = new Date();
    setLocale(prefs.readLocale());
    setTheme(prefs.readTheme());
    setOrder(prefs.readOrder());
    setMetrics(prefs.readMetrics());
    setDayMetric(prefs.readDayMetric());
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
  const panelDay = selectedDay ?? dayReport.day;
  const panelNav = panelDay ? dayNav(panelDay, { firstDay, today }) : { canPrev: false, canNext: false };

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
    setRefreshError(null);
    try {
      const res = await fetch('/api/refresh', { method: 'POST', cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setToday(dayKey(new Date()));
      setRefreshRevision((n) => n + 1);
    } catch (err) {
      setRefreshError(String(err?.message || err));
    } finally {
      setRefreshing(false);
    }
  };
  const onImportCursor = async (file) => {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch('/api/import/cursor', {
        method: 'POST', headers: { 'content-type': 'text/csv; charset=utf-8' },
        body: file, cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setImportResult(body);
      if (body.latestAt != null) {
        setPeriod((p) => currentPeriod(p?.mode ?? 'month', new Date(Math.min(body.latestAt, Date.now()))));
      }
      setRefreshRevision((n) => n + 1);
    } catch (err) {
      setImportError(String(err?.message || err));
    } finally {
      setImporting(false);
    }
  };
  // Clicking the open day again closes the panel.
  const onSelectDay = useCallback((date) => setSelectedDay((d) => (d === date ? null : date)), []);
  const onStepDay = (delta) => setSelectedDay((d) => (d ? shiftDay(d, delta) : d));
  const onCloseDay = useCallback(() => setSelectedDay(null), []);
  const onDayMetric = (value) => {
    prefs.writeDayMetric(value);
    setDayMetric(value);
  };
  const onReorder = (next) => {
    prefs.writeOrder(next);
    setOrder(next);
  };
  const onMetric = (card) => (value) =>
    setMetrics((m) => {
      const next = { ...m, [card]: value };
      prefs.writeMetrics(next);
      return next;
    });
  const onExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await exportReportImage(reportRef.current, `toksight-${periodKey(shown)}.png`);
    } catch (err) {
      setExportError(String(err?.message || err));
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
    const totals = data.totals ?? {};
    const { since, until } = periodBounds(shown);
    const unpriced = data.pricing?.unpricedModels ?? [];
    const modelCount = new Set((data.models ?? []).map((m) => m.model)).size;
    const heroSub = [
      tx('heroRange', { since: dayLabel(locale, since, true), until: dayLabel(locale, until) }),
      since <= today && today <= until ? tx('heroAsOf', { date: dayLabel(locale, today) }) : null,
      tx('heroAgents', { n: Object.keys(data.clients ?? {}).length }),
      tx('heroModels', { n: modelCount }),
    ].filter(Boolean);
    const cardProps = { data, period: shown, locale, tx, agentLabel };

    content = (
      <div ref={reportRef} className={report.loading ? 'report is-loading' : 'report'}>
        <section className="hero">
          <p className="eyebrow">{tx('eyebrow')}</p>
          <h1 className="hero-title">{periodLabel(locale, shown)}</h1>
          <p className="hero-sub">{heroSub.join(' · ')}</p>
          <dl className="kpis">
            <Kpi
              label={tx('kpiTokens')}
              value={fmtTokens(totals.totalTokens)}
              sub={tx('kpiTokensSub', {
                input: fmtTokens((totals.inputTokens ?? 0) + (totals.cacheReadTokens ?? 0) + (totals.cacheWriteTokens ?? 0)),
                output: fmtTokens(totals.outputTokens),
              })}
            />
            <Kpi
              label={tx('kpiCost')}
              value={fmtCost(totals.costUsd)}
              sub={unpriced.length ? tx('kpiCostUnpriced', { n: unpriced.length }) : tx('kpiCostAll')}
            />
            <Kpi label={tx('kpiCache')} value={fmtPct(data.cacheHitRate)} sub={tx('kpiCacheSub', { tokens: fmtTokens(totals.cacheReadTokens) })} />
            <Kpi label={tx('kpiRequests')} value={fmtInt(totals.requests)} sub={tx('kpiRequestsSub', { n: fmtInt(totals.sessions) })} />
          </dl>
        </section>

        <SortableCards order={order} onReorder={onReorder} handleLabel={tx('dragHandle')}>
          {(id, { index, handleProps }) => {
            const shared = { ...cardProps, index, handleProps, metric: metrics[id], onMetric: onMetric(id) };
            if (id === 'heatmap') return <HeatmapCard {...shared} today={today} selected={selectedDay} onSelect={onSelectDay} />;
            if (id === 'agents') return <AgentsCard {...shared} />;
            return <ModelsCard {...shared} />;
          }}
        </SortableCards>

        <footer className="report-foot">
          <span className="foot-brand">
            <BrandMark size={14} />
            toksight v{data.version}
          </span>
          <span>{tx('footRefreshed', { time: fmtDateTime(data.snapshot?.refreshedAt ?? data.generatedAt) })}</span>
          {data.timezone ? <span>{tx('footTimezone', { tz: data.timezone })}</span> : null}
          <span>{tx(data.clients?.cursor ? 'footEstimateCursor' : 'footEstimate')}</span>
          <span>{tx('footLocal')}</span>
          {unpriced.length ? <span className="foot-unpriced">{tx('footUnpriced', { models: unpriced.join(', ') })}</span> : null}
        </footer>
      </div>
    );
  }

  const notices = [
    data && report.error ? tx('errorBody', { error: report.error }) : null,
    refreshError ? tx('refreshFailed', { error: refreshError }) : null,
    importError ? tx('importFailed', { error: importError }) : null,
    exportError ? tx('exportFailed', { error: exportError }) : null,
  ].filter(Boolean);

  return (
    <div className={selectedDay ? 'page has-panel' : 'page'}>
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
        loading={report.loading || refreshing || importing}
        onRefresh={onRefresh}
        importing={importing}
        onImportCursor={onImportCursor}
        exporting={exporting}
        onExport={onExport}
        canExport={hasData && !report.loading}
      />
      <div className="workspace">
        <main className="main">
          {importResult ? (
            <div className="notice is-success" role="status">
              <CircleCheck size={15} strokeWidth={2} aria-hidden="true" />
              <span>{tx('importSuccess', { imported: fmtInt(importResult.imported), updated: fmtInt(importResult.updated), duplicates: fmtInt(importResult.duplicates), skipped: fmtInt(importResult.skipped + importResult.zeroUsage) })}</span>
            </div>
          ) : null}
          {importResult?.warnings?.length ? (
            <details className="notice is-warn">
              <summary><TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />{tx('importWarnings', { n: importResult.warnings.length })}</summary>
              <ul>{importResult.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
            </details>
          ) : null}
          {notices.map((text) => (
            <div key={text} className="notice is-error" role="alert">
              <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
              <span>{coded(text)}</span>
            </div>
          ))}
          {data?.warnings?.length ? (
            <details className="notice is-warn">
              <summary>
                <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
                {tx('warnings', { n: data.warnings.length })}
              </summary>
              <ul>
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {content}
        </main>
        <DayPanel
          open={Boolean(selectedDay)}
          day={panelDay}
          report={dayReport}
          nav={panelNav}
          today={today}
          metric={dayMetric}
          onMetric={onDayMetric}
          onStep={onStepDay}
          onClose={onCloseDay}
          locale={locale}
          tx={tx}
          agentLabel={agentLabel}
        />
      </div>
    </div>
  );
}
