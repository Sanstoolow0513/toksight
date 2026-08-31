'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  Clock,
  Database,
  Filter,
  Flame,
  Gauge,
  Inbox,
  Layers,
  ListOrdered,
  PieChart,
  RefreshCw,
  Timer,
  TrendingUp,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { fmtTokens, fmtCost, fmtPct, fmtDateTime, fmtDuration } from '@/lib/format';
import Heatmap from '@/components/Heatmap';
import TrendChart from '@/components/TrendChart';
import Donut from '@/components/Donut';
import RangeTable from '@/components/RangeTable';
import ModelBars from '@/components/ModelBars';
import AgentHitRate from '@/components/AgentHitRate';
import { HourBars, MonthlyBars } from '@/components/Bars';
import { DEFAULT_LOCALE, readStoredLocale, t, writeStoredLocale } from '@/lib/i18n';

const CLIENT_LABELS = {
  zcode: 'ZCode',
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
  kimi: 'Kimi Code',
};

function coded(text) {
  const parts = String(text).split(/`([^`]+)`/);
  return parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p));
}

function Section({ icon: Icon, title, desc, children }) {
  return (
    <section className="card section">
      <div className="section-head">
        <h2>
          <Icon size={16} strokeWidth={2} />
          {title}
        </h2>
        {desc ? <span className="section-desc">{desc}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Kpi({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className="kpi">
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        <span className={accent ? 'kpi-icon accent' : 'kpi-icon'}>
          <Icon size={14} strokeWidth={2} />
        </span>
      </div>
      <div className={accent ? 'kpi-value accent' : 'kpi-value'}>{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

function Substat({ icon: Icon, label, value, sub }) {
  return (
    <div className="substat">
      <span className="substat-icon">
        <Icon size={16} strokeWidth={2} />
      </span>
      <div className="substat-body">
        <div className="substat-label">{label}</div>
        <div className="substat-value">{value}</div>
        {sub ? <div className="substat-sub">{sub}</div> : null}
      </div>
    </div>
  );
}

const shortId = (id) => String(id ?? '').replace(/^sess_/, '').slice(0, 12) || '—';
const baseDir = (dir) => {
  if (!dir) return null;
  const parts = String(dir).split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || String(dir);
};
const clientLabel = (id) => CLIENT_LABELS[id] || id;
const dateOnly = (ts) => (ts == null ? '—' : fmtDateTime(ts).slice(0, 10));

function LangSwitch({ locale, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      <button type="button" className={locale === 'zh-CN' ? 'on' : ''} onClick={() => onChange('zh-CN')}>
        中文
      </button>
      <button type="button" className={locale === 'en' ? 'on' : ''} onClick={() => onChange('en')}>
        EN
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <>
      <div className="kpi-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kpi">
            <div className="skel" style={{ height: 14, width: 96, marginBottom: 16 }} />
            <div className="skel" style={{ height: 30, width: 128 }} />
            <div className="skel" style={{ height: 12, width: 160, marginTop: 12 }} />
          </div>
        ))}
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="skel-block">
          <div className="skel" style={{ height: 16, width: 140, marginBottom: 20 }} />
          <div className="skel" style={{ height: i === 0 ? 140 : 220 }} />
        </div>
      ))}
    </>
  );
}

export default function Page() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(false);
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);

  const setLocale = useCallback((next) => {
    setLocaleState(next);
    writeStoredLocale(next);
  }, []);

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t(locale, 'docTitle');
  }, [locale]);

  const load = useCallback(async (opts = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const tx = useCallback((key, vars) => t(locale, key, vars), [locale]);

  const nav = (
    <div className="topnav">
      <div className="topnav-inner">
        <div className="brand">
          <h1 className="logo">
            toksight<span className="logo-dot">.</span>
          </h1>
          <span className="live-badge">
            <i className="live-dot" />
            {tx('live')}
          </span>
        </div>
        <div className="head-actions">
          <LangSwitch locale={locale} onChange={setLocale} label={tx('langGroup')} />
          <label className="auto-label">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            {tx('autoRefresh')}
          </label>
          <button className="btn" type="button" onClick={load} disabled={loading}>
            <RefreshCw size={14} strokeWidth={2} className={loading ? 'icon-spin' : undefined} />
            {loading ? tx('refreshing') : tx('refresh')}
          </button>
        </div>
      </div>
    </div>
  );

  if (error && !data) {
    return (
      <>
        {nav}
        <div className="wrap">
          <div className="card error-card">
            <h1>
              <TriangleAlert size={18} strokeWidth={2} />
              {tx('errorTitle')}
            </h1>
            <p>{coded(tx('errorFail', { error }))}</p>
            <p>{coded(tx('errorHint'))}</p>
            <button className="btn" type="button" onClick={load}>
              <RefreshCw size={14} strokeWidth={2} />
              {tx('retry')}
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        {nav}
        <div className="wrap">
          <Skeleton />
        </div>
      </>
    );
  }

  const totals = data.totals ?? {};
  const unpriced = data.pricing?.unpricedModels ?? [];
  const longest = data.longestSession;
  const heatDays = data.heatmap?.days ?? [];
  const activeWindowDays = heatDays.filter((d) => d.tokens > 0).length;
  const windowPeak = heatDays.reduce((best, d) => (!best || d.tokens > best.tokens ? d : best), null);
  const streaks = data.streaks ?? {};
  const peakDay = data.peakDay;
  const filtered = Boolean(data.clientsFilter?.length || data.range?.since != null || data.range?.until != null);
  const heatDesc = [tx('heatDesc', { weeks: data.heatmap?.weeks ?? 53 }), activeWindowDays ? tx('heatActive', { n: activeWindowDays }) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      {nav}
      <div className="wrap">
        <p className="head-sub">
          {tx('subtitle')}
          {data.timezone ? ` · ${data.timezone}` : ''}
        </p>

        {data.warnings?.length > 0 && (
          <div className="warn">
            <TriangleAlert size={14} strokeWidth={2} />
            <div>
              {data.warnings.map((w, i) => (
                <div key={i}>
                  {tx('warnPrefix')}：{w}
                </div>
              ))}
            </div>
          </div>
        )}

        {filtered && (
          <div className="filter-note">
            <Filter size={14} strokeWidth={2} />
            <span>
              {tx('filterNote')}
              {[
                data.clientsFilter?.length ? tx('filterClient', { clients: data.clientsFilter.map(clientLabel).join(', ') }) : null,
                data.range?.since != null ? tx('filterSince', { date: fmtDateTime(data.range.since).slice(0, 10) }) : null,
                data.range?.until != null ? tx('filterUntil', { date: fmtDateTime(data.range.until).slice(0, 10) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        )}

        {totals.requests === 0 ? (
          <div className="card error-card">
            <h1>
              <Inbox size={18} strokeWidth={2} />
              {tx('emptyTitle')}
            </h1>
            <p>{coded(tx('emptyBody'))}</p>
          </div>
        ) : (
          <>
            <div className="kpi-grid">
              <Kpi
                icon={Zap}
                label={tx('statTokens')}
                value={fmtTokens(totals.totalTokens)}
                sub={tx('statTokensSub', { requests: totals.requests ?? 0, sessions: totals.sessions ?? 0 })}
              />
              <Kpi
                icon={CircleDollarSign}
                label={tx('statCost')}
                value={fmtCost(totals.costUsd)}
                sub={unpriced.length ? tx('statCostUnpriced', { n: unpriced.length }) : tx('statCostPriced')}
              />
              <Kpi
                icon={Database}
                label={tx('statCache')}
                value={fmtPct(data.cacheHitRate)}
                accent
                sub={tx('statCacheSub', { tokens: fmtTokens(totals.cacheReadTokens) })}
              />
              <Kpi
                icon={CalendarDays}
                label={tx('statActiveDays')}
                value={data.activeDays ?? activeWindowDays}
                sub={data.activityRange?.firstAt ? tx('statActiveSince', { date: dateOnly(data.activityRange.firstAt) }) : '—'}
              />
            </div>

            <div className="card section substats">
              <Substat
                icon={Flame}
                label={tx('statStreak')}
                value={Number.isFinite(streaks.current) ? tx('statStreakValue', { n: streaks.current }) : '—'}
                sub={Number.isFinite(streaks.longest) ? tx('statStreakLongest', { n: streaks.longest }) : null}
              />
              <Substat
                icon={TrendingUp}
                label={tx('statPeak')}
                value={peakDay ? fmtTokens(peakDay.tokens) : '—'}
                sub={peakDay?.date ?? (windowPeak?.tokens > 0 ? `${windowPeak.date} · ${fmtTokens(windowPeak.tokens)}` : null)}
              />
              <Substat
                icon={Timer}
                label={tx('statLongest')}
                value={fmtDuration(longest?.durationMs)}
                sub={longest ? `${clientLabel(longest.client)} · ${fmtTokens(longest.totalTokens)}` : '—'}
              />
            </div>

            <Section icon={Activity} title={tx('heatTitle')} desc={heatDesc}>
              <Heatmap heatmap={data.heatmap} locale={locale} />
            </Section>

            <Section icon={TrendingUp} title={tx('trendTitle')} desc={tx('trendDesc')}>
              <TrendChart trends={{ 7: data.trend7, 30: data.trend, 90: data.trend90 }} locale={locale} />
            </Section>

            <div className="grid-2">
              <Section icon={CalendarRange} title={tx('rangeTitle')} desc={tx('rangeDesc')}>
                <RangeTable data={data} totals={totals} locale={locale} />
              </Section>
              <Section icon={PieChart} title={tx('donutTitle')} desc={tx('donutDesc')}>
                <Donut
                  locale={locale}
                  items={agents.map((a) => ({ name: clientLabel(a.id), value: a.totalTokens, costUsd: a.costUsd }))}
                  centerValue={fmtTokens(totals.totalTokens)}
                  centerLabel={tx('donutCenter')}
                />
              </Section>
            </div>

            <div className="grid-2">
              <Section icon={Clock} title={tx('hourTitle')} desc={tx('hourDesc')}>
                <HourBars hourly={data.hourly} locale={locale} />
              </Section>
              <Section icon={BarChart3} title={tx('monthTitle')} desc={tx('monthDesc')}>
                <MonthlyBars monthly={data.monthly} locale={locale} />
              </Section>
            </div>

            <Section icon={Layers} title={tx('modelTitle')} desc={tx('modelDesc')}>
              <ModelBars models={data.models ?? []} totalTokens={totals.totalTokens} locale={locale} />
              <details className="details">
                <summary>{tx('details')}</summary>
                <div className="table-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>{tx('thModel')}</th>
                        <th>{tx('thAgent')}</th>
                        <th className="num">{tx('thRequests')}</th>
                        <th className="num">{tx('thInput')}</th>
                        <th className="num">{tx('thCacheRead')}</th>
                        <th className="num">{tx('thCacheWrite')}</th>
                        <th className="num">{tx('thOutput')}</th>
                        <th className="num">{tx('thHitRate')}</th>
                        <th className="num">{tx('thCost')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.models ?? []).map((m) => (
                        <tr key={`${m.client}/${m.model}`}>
                          <td className="mono">{m.model}</td>
                          <td className="dim">{clientLabel(m.client)}</td>
                          <td className="num">{m.requests}</td>
                          <td className="num">{fmtTokens(m.inputTokens)}</td>
                          <td className="num">{fmtTokens(m.cacheReadTokens)}</td>
                          <td className="num">{fmtTokens(m.cacheWriteTokens)}</td>
                          <td className="num">{fmtTokens(m.outputTokens)}</td>
                          <td className="num">{fmtPct(m.cacheHitRate)}</td>
                          <td className="num">{fmtCost(m.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </Section>

            <Section icon={Gauge} title={tx('agentTitle')} desc={tx('agentDesc')}>
              <AgentHitRate
                agents={agents.map((a) => ({ ...a, label: clientLabel(a.id) }))}
                models={data.models ?? []}
                locale={locale}
              />
            </Section>

            <Section icon={ListOrdered} title={tx('sessTitle')} desc={tx('sessDesc', { n: data.topSessions?.length ?? 0 })}>
              <div className="table-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{tx('thSession')}</th>
                      <th>{tx('thAgent')}</th>
                      <th>{tx('thModel')}</th>
                      <th>{tx('thStarted')}</th>
                      <th className="num">{tx('thDuration')}</th>
                      <th className="num">{tx('thTokens')}</th>
                      <th className="num">{tx('thCost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.topSessions ?? []).map((s) => (
                      <tr key={`${s.client}/${s.sessionId}`} title={s.directory || undefined}>
                        <td>
                          <div className="sess-title">{s.title || shortId(s.sessionId)}</div>
                          {baseDir(s.directory) ? <div className="sess-dir">{baseDir(s.directory)}</div> : null}
                        </td>
                        <td className="dim">{clientLabel(s.client)}</td>
                        <td className="dim mono">
                          {s.models?.length ? `${s.models.slice(0, 2).join(', ')}${s.models.length > 2 ? ` +${s.models.length - 2}` : ''}` : '—'}
                        </td>
                        <td className="dim">{fmtDateTime(s.startedAt)}</td>
                        <td className="num">{fmtDuration(s.durationMs)}</td>
                        <td className="num">{fmtTokens(s.totalTokens)}</td>
                        <td className="num">{fmtCost(s.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )}

        <footer className="foot">
          <span>
            {tx('footRange', {
              range: data.activityRange?.firstAt
                ? `${fmtDateTime(data.activityRange.firstAt)} → ${fmtDateTime(data.activityRange.lastAt)}`
                : '—',
            })}
          </span>
          <span>{tx('footGenerated', { time: fmtDateTime(data.generatedAt) })}</span>
          {unpriced.length > 0 && <span>{tx('footUnpriced', { models: unpriced.join(', ') })}</span>}
          <span>{tx('footLocal', { version: data.version })}</span>
        </footer>
      </div>
    </>
  );
}
