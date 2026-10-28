'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToasts } from '@/components/Toasts';
import { useRangeReport, useReport, useSelectionReport } from '@/lib/useReport';
import { dayKey, detectedTimezone, isContiguous, periodKey, quickPeriod, shiftDay, validTimezone } from '@/lib/period';
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
  // Calendar: the selected local days (sorted), the range anchor, the zoom
  // level and the first active day of the whole history (from scopeRange).
  const [selection, setSelection] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const [calendarZoom, setCalendarZoom] = useState('large');
  const [firstDays, setFirstDays] = useState({});
  const reportRef = useRef(null);
  const toasts = useToasts();
  const { push: pushToast } = toasts;
  const tx = useCallback((key, vars) => t(locale, key, vars), [locale]);
  const reportView = view === 'today' || view === 'calendar';
  const ready = Boolean(prices.status?.completed) && Boolean(today);

  // Today: one local day for all agents, plus the last 30 days for the trend.
  const activePeriod = ready && view === 'today' ? quickPeriod('1d', today) : null;
  const report = useReport(activePeriod, refreshRevision, timezone);
  const trend = useRangeReport(ready && view === 'today' ? shiftDay(today, -29) : null, today, refreshRevision, timezone);

  // Calendar: the full history in one request (until the first day is known,
  // today alone, which reports it), and the selection's details.
  const firstDay = timezone ? firstDays[timezone] ?? null : null;
  const historyOn = ready && view === 'calendar';
  const history = useRangeReport(historyOn ? (firstDay && firstDay < today ? firstDay : today) : null, today, refreshRevision, timezone);
  const scopeFirstAt = [report, history].map((r) => r.data?.timezone === timezone ? r.data?.scopeRange : undefined).find((range) => range !== undefined);
  const scopeFirstDay = scopeFirstAt === undefined ? undefined : scopeFirstAt?.firstAt != null ? dayKey(new Date(scopeFirstAt.firstAt), timezone) : today;
  useEffect(() => {
    if (scopeFirstDay && timezone && firstDays[timezone] !== scopeFirstDay) setFirstDays((previous) => ({ ...previous, [timezone]: scopeFirstDay }));
  }, [scopeFirstDay, timezone, firstDays]);
  const calendarStart = firstDay ? `${(firstDay < today ? firstDay : today).slice(0, 7)}-01` : today;
  const historyComplete = Boolean(history.data && firstDay && history.since === (firstDay < today ? firstDay : today) && history.until === today);
  const selectable = useCallback((key) => Boolean(today && calendarStart) && key >= calendarStart && key <= today, [today, calendarStart]);
  const selected = useMemo(() => {
    const keys = (selection ?? []).filter(selectable);
    return keys.length ? keys : today ? [today] : [];
  }, [selection, selectable, today]);
  const contiguous = isContiguous(selected);
  const selectionReport = useSelectionReport(historyOn ? selected : null, contiguous, refreshRevision, timezone);

  const current = view === 'calendar' ? history : report;
  const data = view === 'calendar' ? (historyComplete ? history.data : null) : report.timezone === timezone ? report.data : null;
  const shown = report.period;
  const pending = view === 'today' ? Boolean(activePeriod) && (JSON.stringify(activePeriod) !== JSON.stringify(shown) || timezone !== report.timezone)
    : historyOn && !historyComplete;
  const reportBusy = current.loading || (pending && !current.error);
  const selectionPending = view === 'calendar' && (selectionReport.key !== selected.join(',') || !selectionReport.data || selectionReport.loading || Boolean(selectionReport.error));
  const updatingPrices = priceUpdating || Boolean(prices.status?.updating);
  const busy = prices.busy || refreshing || updatingPrices || Boolean(databaseBusy) || exporting;
  const hasData = view === 'calendar' ? Boolean(data) : Boolean(data && shown && shown.preset === '1d');

  useEffect(() => {
    const zone = detectedTimezone(), pref = prefs.readTimezone();
    setLocale(prefs.readLocale());
    setTheme(prefs.readTheme());
    setAgentSort(prefs.readAgentSort());
    setCalendarZoom(prefs.readCalendarZoom());
    setTimezonePref(pref);
    setSystemZone(zone);
    setNow(Date.now());
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
  const staleError = hasData ? current.error : null;
  useEffect(() => { if (staleError) pushToast({ key: 'report-error', tone: 'error', message: ['errorBody', { error: staleError }] }); }, [staleError, pushToast]);
  const warningText = data?.warnings?.join('\n') ?? '';
  const lastWarning = useRef('');
  useEffect(() => {
    if (!warningText || warningText === lastWarning.current) return;
    lastWarning.current = warningText;
    const items = warningText.split('\n');
    pushToast({ key: 'warnings', tone: 'warn', message: ['warnings', { n: items.length }], details: { items } });
  }, [warningText, pushToast]);
  const clientList = report.data?.view?.availableClients ?? history.data?.view?.availableClients;
  const labels = useMemo(() => new Map((clientList ?? []).map((c) => [c.id, c.label])), [clientList]);
  const agentLabel = useCallback((id) => labels.get(id) ?? id, [labels]);
  const onTheme = (value) => { prefs.writeTheme(value); setTheme(value); };
  const onLocale = (value) => { prefs.writeLocale(value); setLocale(value); };
  const onTimezone = (value) => {
    if (value !== 'auto' && !validTimezone(value)) return;
    prefs.writeTimezone(value); setTimezonePref(value); setNow(Date.now()); setSelection(null); setAnchor(null);
  };
  const onAgentSort = (value) => { prefs.writeAgentSort(value); setAgentSort(value); };
  const onToggleAgent = (id) => setOpenAgents((previous) => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; });
  const onCalendarZoom = useCallback((value) => { prefs.writeCalendarZoom(value); setCalendarZoom(value); }, []);
  // Selections are sorted unique keys; `anchor` is where Shift ranges start.
  const onSelect = useCallback((keys, nextAnchor) => {
    const next = [...new Set(keys)].filter(selectable).sort();
    if (!next.length) return;
    setSelection(next);
    if (nextAnchor !== undefined) setAnchor(nextAnchor);
  }, [selectable]);
  const showLatest = (timestamp) => {
    const day = dayKey(new Date(Math.min(timestamp, Date.now())), timezone);
    setSelection([day]); setAnchor(day); setView('calendar');
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

  const canExport = reportView && hasData && !reportBusy && !pending && !(view === 'calendar' && selectionPending) && !current.error && !busy;
  const onExport = async () => {
    if (!canExport || !reportRef.current) return;
    setExporting(true);
    try {
      const name = view === 'calendar' ? `toksight-calendar-${selected[0]}${selected.length > 1 ? '_' + selected.at(-1) : ''}.png` : `toksight-all-${periodKey(shown)}.png`;
      await exportReportImage(reportRef.current, name);
    } catch (err) {
      pushToast({ key: 'export', tone: 'error', message: ['exportFailed', { error: String(err?.message || err) }] });
    } finally { setExporting(false); }
  };
  const shared = { locale, tx, agentLabel, sortBy: agentSort, onSort: onAgentSort };
  return {
    prices, view, setView, locale, theme, timezone, timezonePref, systemZone, now, today,
    activePeriod, report, trend, history, current, data, shown, reportBusy, reportView, hasData,
    selected, anchor, contiguous, selectionReport, calendarStart, calendarZoom, reportRef, shared, openAgents,
    busy, refreshing, updatingPrices, exporting, canExport, refreshRevision,
    databaseBusy, databaseFile, databaseError, priceResetOpen, priceResetError, toasts, tx,
    onTheme, onLocale, onTimezone, onToggleAgent, onRefresh, onUpdatePrices, onSelect, onCalendarZoom,
    onResetPrices, onSetup, onSelectDatabase, onImportDatabase, onExportDatabase,
    onExport, setPriceResetOpen, setPriceResetError, setDatabaseFile,
  };
}
