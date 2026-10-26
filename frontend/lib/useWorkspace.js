'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToasts } from '@/components/Toasts';
import { useDayReport, useReport } from '@/lib/useReport';
import { dayKey, dayNav, detectedTimezone, inPeriod, periodBounds, periodKey, periodOf, quickPeriod, shiftDay, validTimezone } from '@/lib/period';
import { dailyMap, openingDay } from '@/lib/report';
import { fmtInt } from '@/lib/format';
import { DEFAULT_LOCALE, t } from '@/lib/i18n';
import { exportReportImage } from '@/lib/exportImage';
import * as prefs from '@/lib/prefs';
import { usePriceDatabase } from '@/lib/usePriceDatabase';

export function useWorkspace() {
  const prices = usePriceDatabase();
  const [view, setView] = useState('today');
  const [locale, setLocale] = useState(DEFAULT_LOCALE);
  const [theme, setTheme] = useState(null);
  const [period, setPeriod] = useState(null);
  const [agent, setAgent] = useState('');
  const [now, setNow] = useState(null);
  const [timezonePref, setTimezonePref] = useState(null);
  const [systemZone, setSystemZone] = useState(null);
  const timezone = timezonePref === 'auto' ? systemZone : timezonePref;
  const today = now && timezone ? dayKey(new Date(now), timezone) : null;
  const [agentSort, setAgentSort] = useState('tokens');
  const [openAgents, setOpenAgents] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [priceUpdating, setPriceUpdating] = useState(false);
  const [priceResetOpen, setPriceResetOpen] = useState(false);
  const [priceResetError, setPriceResetError] = useState(null);
  const [databaseBusy, setDatabaseBusy] = useState(null);
  const [databaseFile, setDatabaseFile] = useState(null);
  const [databaseError, setDatabaseError] = useState(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const reportRef = useRef(null);
  const toasts = useToasts();
  const { push: pushToast } = toasts;
  const tx = useCallback((key, vars) => t(locale, key, vars), [locale]);
  const reportView = view === 'today' || view === 'calendar';
  const activePeriod = !prices.status?.completed || !reportView || !today ? null : view === 'today' ? quickPeriod('1d', today)
    : period?.preset ? quickPeriod(period.preset, today) : period;
  const report = useReport(activePeriod, refreshRevision, agent, timezone);
  const data = report.timezone === timezone ? report.data : null;
  const shown = report.period;
  const pending = Boolean(activePeriod) && (JSON.stringify(activePeriod) !== JSON.stringify(shown) || agent !== report.agent || timezone !== report.timezone);
  const reportBusy = report.loading || (pending && !report.error);
  const days = useMemo(() => dailyMap(data?.daily), [data?.daily]);
  const calendarDay = view === 'calendar' && data && shown
    ? openingDay(days, { ...periodBounds(shown), today, selected: selectedDay }) : null;
  const dayReport = useDayReport(calendarDay, refreshRevision, report.agent ?? agent, timezone);
  const dayPending = view === 'calendar' && (dayReport.day !== calendarDay || !dayReport.data || dayReport.loading || Boolean(dayReport.error));
  const firstAt = data?.scopeRange?.firstAt;
  const firstDay = firstAt != null ? dayKey(new Date(firstAt), timezone) : null;
  const bounds = shown?.mode === 'custom' ? periodBounds(shown) : null;
  const selectedNav = calendarDay ? dayNav(calendarDay, { firstDay: bounds?.since ?? firstDay, today: bounds && bounds.until < today ? bounds.until : today }) : {};
  const updatingPrices = priceUpdating || Boolean(prices.status?.updating);
  const busy = prices.busy || refreshing || updatingPrices || Boolean(databaseBusy) || exporting;
  const hasData = Boolean(data && shown && (view !== 'today' || shown.preset === '1d'));

  useEffect(() => {
    const zone = detectedTimezone(), pref = prefs.readTimezone();
    setLocale(prefs.readLocale());
    setTheme(prefs.readTheme());
    setAgentSort(prefs.readAgentSort());
    setTimezonePref(pref);
    setSystemZone(zone);
    setNow(Date.now());
    setPeriod(periodOf(dayKey(new Date(), pref === 'auto' ? zone : pref), prefs.readMode()));
    const tick = () => { setNow(Date.now()); setSystemZone(detectedTimezone()); };
    const clock = setInterval(tick, 30000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(clock); window.removeEventListener('focus', tick); };
  }, []);
  useEffect(() => {
    if (!theme) return;
    const apply = () => { document.documentElement.dataset.theme = prefs.resolveTheme(theme); };
    apply();
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => { document.documentElement.lang = locale; document.title = tx('docTitle'); }, [locale, tx]);
  useEffect(() => {
    if (!today) return;
    setPeriod((p) => {
      if (!p || p.preset) return p;
      if (periodBounds(p).since > today) return periodOf(today, 'month');
      return p.mode === 'custom' && p.until > today ? { ...p, until: today } : p;
    });
  }, [today]);
  const staleError = hasData ? report.error : null;
  useEffect(() => { if (staleError) pushToast({ key: 'report-error', tone: 'error', message: ['errorBody', { error: staleError }] }); }, [staleError, pushToast]);
  const warningText = data?.warnings?.join('\n') ?? '';
  const lastWarning = useRef('');
  useEffect(() => {
    if (!warningText || warningText === lastWarning.current) return;
    lastWarning.current = warningText;
    const items = warningText.split('\n');
    pushToast({ key: 'warnings', tone: 'warn', message: ['warnings', { n: items.length }], details: { items } });
  }, [warningText, pushToast]);
  const labels = useMemo(() => new Map((report.data?.view?.availableClients ?? []).map((c) => [c.id, c.label])), [report.data]);
  const agentLabel = useCallback((id) => labels.get(id) ?? id, [labels]);
  const onPeriod = (value) => { setPeriod(value); setSelectedDay(null); };
  const onAgent = (value) => { setAgent(value); setSelectedDay(null); };
  const onTheme = (value) => { prefs.writeTheme(value); setTheme(value); };
  const onLocale = (value) => { prefs.writeLocale(value); setLocale(value); };
  const onTimezone = (value) => {
    if (value !== 'auto' && !validTimezone(value)) return;
    prefs.writeTimezone(value); setTimezonePref(value); setNow(Date.now()); setSelectedDay(null);
    const day = dayKey(new Date(), value === 'auto' ? systemZone : value);
    if (period && periodBounds(period).since > day) setPeriod(periodOf(day, 'month'));
  };
  const onAgentSort = (value) => { prefs.writeAgentSort(value); setAgentSort(value); };
  const onToggleAgent = (id) => setOpenAgents((previous) => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; });
  const showLatest = (timestamp) => {
    const day = dayKey(new Date(Math.min(timestamp, Date.now())), timezone);
    setPeriod(periodOf(day, 'month')); setSelectedDay(day); setView('calendar');
  };
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/refresh', { method: 'POST', cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setNow(Date.now());
      setRefreshRevision((n) => n + 1);
      await prices.reload();
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
      await prices.reload();
      setRefreshRevision((n) => n + 1);
    } catch (err) {
      pushToast({ key: 'prices', tone: 'error', message: ['priceUpdateFailed', { error: String(err?.message || err) }] });
    } finally {
      setPriceUpdating(false);
    }
  };
  const onResetPrices = async () => {
    if (busy) return;
    setPriceResetError(null);
    try {
      await prices.reset();
      setPriceResetOpen(false);
      setRefreshRevision((n) => n + 1);
      pushToast({ key: 'prices', tone: 'success', message: ['priceResetSuccess'] });
    } catch (err) { setPriceResetError(String(err?.message || err)); }
  };
  const onSetup = async (options) => {
    try {
      const body = await prices.setup(options);
      if (body.warnings?.length) pushToast({ key: 'prices', tone: 'warn', message: ['priceUpdateWarnings', { count: body.warnings.length }], details: { items: body.warnings } });
      setRefreshRevision((n) => n + 1);
    } catch { /* The setup panel retains the error and allows retry. */ }
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
      await prices.reload();
      if (body.latestAt != null) showLatest(body.latestAt);
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
      link.download = `toksight-backup-${dayKey(new Date(), timezone)}-${Date.now()}.sqlite`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      pushToast({ key: 'database', tone: 'success', message: ['databaseExportSuccess'] });
    } catch (err) {
      pushToast({ key: 'database', tone: 'error', message: ['databaseExportFailed', { error: String(err?.message || err) }] });
    } finally { setDatabaseBusy(null); }
  };

  const onStepDay = (delta) => {
    if (!calendarDay || (delta < 0 ? !selectedNav.canPrev : !selectedNav.canNext)) return;
    const next = shiftDay(calendarDay, delta);
    setSelectedDay(next);
    if (shown.mode !== 'custom' && !inPeriod(next, shown)) setPeriod(periodOf(next, shown.mode));
  };
  const canExport = reportView && hasData && !reportBusy && !pending && !dayPending && !report.error && !busy;
  const onExport = async () => {
    if (!canExport || !reportRef.current) return;
    setExporting(true);
    try {
      await exportReportImage(reportRef.current, 'toksight-' + (report.agent || 'all') + '-' + periodKey(shown) + (view === 'calendar' ? '-' + calendarDay : '') + '.png');
    } catch (err) {
      pushToast({ key: 'export', tone: 'error', message: ['exportFailed', { error: String(err?.message || err) }] });
    } finally { setExporting(false); }
  };
  const shared = { locale, tx, agentLabel, sortBy: agentSort, onSort: onAgentSort };
  return {
    prices, view, setView, locale, theme, timezone, timezonePref, systemZone, now, today,
    period, activePeriod, agent, report, data, shown, reportBusy, reportView, hasData,
    calendarDay, dayReport, selectedNav, firstDay, reportRef, shared, openAgents,
    busy, refreshing, updatingPrices, exporting, canExport, refreshRevision,
    databaseBusy, databaseFile, databaseError, priceResetOpen, priceResetError, toasts, tx,
    onPeriod, onAgent, onTheme, onLocale, onTimezone, onToggleAgent, onRefresh, onUpdatePrices,
    onResetPrices, onSetup, onSelectDatabase, onImportDatabase, onExportDatabase, onStepDay,
    onExport, setSelectedDay, setPriceResetOpen, setPriceResetError, setDatabaseFile,
  };
}
