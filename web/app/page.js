'use client';

// toksight report: a centred column on a dot grid — KPIs, three reorderable
// chapter cards (heatmap · agents · models) and a footer.
// Everything inside `.report` is what "Export image" captures. Clicking a
// heatmap day opens the day card beside the column (the pair re-centres on
// wide screens; it floats over the page on narrow ones); the card never
// enters the exported image.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Inbox, RefreshCw, TriangleAlert } from 'lucide-react';
import Toolbar from '@/components/Toolbar';
import ReportActions from '@/components/ReportActions';
import SortableCards from '@/components/SortableCards';
import HeatmapCard from '@/components/HeatmapCard';
import AgentsCard from '@/components/AgentsCard';
import ModelsCard from '@/components/ModelsCard';
import DayPanel from '@/components/DayPanel';
import BrandMark from '@/components/BrandMark';
import Toasts, { useToasts } from '@/components/Toasts';
import { useDayReport, useReport } from '@/lib/useReport';
import { currentPeriod, dayKey, dayNav, periodKey, periodNav, shiftDay, shiftPeriod, withMode } from '@/lib/period';
import { fmtCost, fmtDateTime, fmtInt, fmtPct, fmtTokens } from '@/lib/format';
import { DEFAULT_LOCALE, periodLabel, t } from '@/lib/i18n';
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
      <div className="skel skel-kpis" />
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
  const [metrics, setMetrics] = useState(() => Object.fromEntries(prefs.CARD_IDS.map((id) => [id, id === 'models' ? 'cost' : 'tokens'])));
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [priceUpdating, setPriceUpdating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [dayMetric, setDayMetric] = useState('tokens');
  const reportRef = useRef(null);
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
    const totals = data.totals ?? {};
    const unpriced = data.pricing?.unpricedModels ?? [];
    const cursorUnpriced = (data.clients?.cursor?.pricedRequests ?? 0) < (data.clients?.cursor?.requests ?? 0);
    const cardProps = { data, period: shown, locale, tx, agentLabel };

    content = (
      <div ref={reportRef} className={report.loading ? 'report is-loading' : 'report'}>
        <section className="hero">
          <h1 className="visually-hidden">{tx('eyebrow')} · {periodLabel(locale, shown)}</h1>
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
          {(id, { handleProps }) => {
            const shared = { ...cardProps, handleProps, metric: metrics[id], onMetric: onMetric(id) };
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
        loading={report.loading || refreshing || priceUpdating || importing}
        onRefresh={onRefresh}
      />
      <div className={selectedDay ? 'workspace has-panel' : 'workspace'}>
        <main className="main">
          <ReportActions
            tx={tx}
            loading={report.loading || refreshing || priceUpdating || importing}
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
      <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} tx={tx} />
    </div>
  );
}
