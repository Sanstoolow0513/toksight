'use client';

// toksight dashboard — Brutalism phosphor worksheet (design-spec v6): a 2px
// framed mosaic. Masthead → 4-cell KPI strip → 12-col sheet (trend, heatmap,
// agent/model, hour/month/pace, sessions). Hard invert on hover, no chrome
// radius/blur/shadow. Icons only mark actions and states; last-fetch time
// comes from generatedAt.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, RefreshCw, TriangleAlert, Filter } from 'lucide-react';
import Link from 'next/link';
import { fmtTokens, fmtCost, fmtPct, fmtDateTime, fmtDuration } from '@/lib/format';
import Heatmap from '@/components/Heatmap';
import TrendChart from '@/components/TrendChart';
import AgentsPanel from '@/components/AgentsPanel';
import ModelBars from '@/components/ModelBars';
import { HourBars, MonthlyBars } from '@/components/Bars';
import { DEFAULT_LOCALE, readStoredLocale, t, writeStoredLocale } from '@/lib/i18n';

const CLIENT_LABELS = {
  zcode: 'ZCode',
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  kimi: 'Kimi Code',
};

function coded(text) {
  const parts = String(text).split(/`([^`]+)`/);
  return parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p));
}

function Cell({ title, desc, extra, span = 12, children }) {
  return (
    <section className={`cell span-${span}`}>
      <div className="cell-head">
        <h2>{title}</h2>
        {desc ? <span className="cell-desc">{desc}</span> : null}
        {extra ? <div className="cell-extra">{extra}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className={tone ? `stat stat-${tone}` : 'stat'}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

const clientLabel = (id) => CLIENT_LABELS[id] || id;
const dateOnly = (ts) => (ts == null ? '—' : fmtDateTime(ts).slice(0, 10));
const sessionName = (s) => s.title || s.directory || s.sessionId || '—';

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
      <div className="skel-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <div className="skel" style={{ height: 11, width: 76, marginBottom: 12 }} />
            <div className="skel" style={{ height: 34, width: 140 }} />
          </div>
        ))}
      </div>
      <div className="skel-cell">
        <div className="skel" style={{ height: 14, width: 140, marginBottom: 24 }} />
        <div className="skel" style={{ height: 300 }} />
      </div>
      <div className="skel-cell">
        <div className="skel" style={{ height: 14, width: 140, marginBottom: 24 }} />
        <div className="skel" style={{ height: 180 }} />
      </div>
    </>
  );
}

function Rhythm({ streaks, peakDay, longest, tx }) {
  return (
    <dl className="rhythm">
      <div className="rhythm-row">
        <dt>{tx('statStreak')}</dt>
        <dd>
          {Number.isFinite(streaks.current) ? <b>{tx('statStreakValue', { n: streaks.current })}</b> : '—'}
          {Number.isFinite(streaks.longest) ? ` · ${tx('statStreakLongest', { n: streaks.longest })}` : ''}
        </dd>
      </div>
      <div className="rhythm-row">
        <dt>{tx('statPeak')}</dt>
        <dd>{peakDay ? <><b>{fmtTokens(peakDay.tokens)}</b> · {peakDay.date}</> : '—'}</dd>
      </div>
      <div className="rhythm-row">
        <dt>{tx('statLongest')}</dt>
        <dd>
          {longest ? (
            <>
              <b>{fmtDuration(longest.activeMs)}</b> · {clientLabel(longest.client)}
              {longest.durationMs != null ? ` · ${tx('statLongestSpan', { duration: fmtDuration(longest.durationMs) })}` : ''}
            </>
          ) : (
            '—'
          )}
        </dd>
      </div>
    </dl>
  );
}

function SessionTable({ rows, tx }) {
  if (!rows.length) return <div className="muted">{tx('sessEmpty')}</div>;
  return (
    <div className="table-scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>{tx('thRank')}</th>
            <th>{tx('thAgent')}</th>
            <th>{tx('thSession')}</th>
            <th className="num">{tx('thTokens')}</th>
            <th className="num">{tx('thRequests')}</th>
            <th className="num">{tx('thHitRate')}</th>
            <th className="num">{tx('thCost')}</th>
            <th>{tx('thStarted')}</th>
            <th className="num">{tx('thActive')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const name = sessionName(s);
            return (
              <tr key={`${s.client}/${s.sessionId}`}>
                <td className="num dim">{i + 1}</td>
                <td>{clientLabel(s.client)}</td>
                <td>
                  <span className="sess-name" title={name}>
                    {name}
                  </span>
                </td>
                <td className="num">{fmtTokens(s.totalTokens)}</td>
                <td className="num">{s.requests}</td>
                <td className="num">{fmtPct(s.cacheHitRate)}</td>
                <td className="num">{fmtCost(s.costUsd)}</td>
                <td className="dim">{dateOnly(s.startedAt)}</td>
                <td className="num">{fmtDuration(s.activeMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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

  const masthead = (
    <header className="masthead">
      <div className="brand">
        <h1 className="logo-chip">toksight</h1>
        {data && <span className="fetch-meta">{tx('live', { time: fmtDateTime(data.generatedAt) })}</span>}
      </div>
      <div className="head-actions">
        <nav className="top-nav" aria-label={tx('navAria')}>
          <Link className="active" href="/" aria-current="page">{tx('navDashboard')}</Link>
          <Link href="/config">{tx('navConfig')}</Link>
        </nav>
        <LangSwitch locale={locale} onChange={setLocale} label={tx('langGroup')} />
        <label className="auto-label">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          {tx('autoRefresh')}
        </label>
        <button className="btn" type="button" onClick={load} disabled={loading}>
          <RefreshCw size={14} strokeWidth={2} className={loading ? 'icon-spin' : undefined} aria-hidden="true" />
          {loading ? tx('refreshing') : tx('refresh')}
        </button>
      </div>
    </header>
  );

  const shell = (body) => (
    <div className="wrap">
      <div className="frame">
        {masthead}
        {body}
      </div>
    </div>
  );

  if (error && !data) {
    return shell(
      <div className="state-card" role="alert">
        <h1>
          <TriangleAlert size={18} strokeWidth={2} aria-hidden="true" />
          {tx('errorTitle')}
        </h1>
        <p>{coded(tx('errorFail', { error }))}</p>
        <p>{coded(tx('errorHint'))}</p>
        <button className="btn" type="button" onClick={load}>
          <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
          {tx('retry')}
        </button>
      </div>,
    );
  }

  if (!data) {
    return shell(<Skeleton />);
  }

  const totals = data.totals ?? {};
  const unpriced = data.pricing?.unpricedModels ?? [];
  const longest = data.longestSession;
  const heatDays = data.heatmap?.days ?? [];
  const activeWindowDays = heatDays.filter((d) => d.tokens > 0).length;
  const streaks = data.streaks ?? {};
  const peakDay = data.peakDay;
  const filtered = Boolean(data.clientsFilter?.length || data.range?.since != null || data.range?.until != null);
  const heatDesc = [tx('heatDesc', { weeks: data.heatmap?.weeks ?? 53 }), activeWindowDays ? tx('heatActive', { n: activeWindowDays }) : null]
    .filter(Boolean)
    .join(' · ');
  const topSessions = (data.topSessions ?? []).slice(0, 10);

  const rangeChips = [
    { key: 'today', label: tx('rangeToday'), r: data.today },
    { key: '7d', label: tx('range7d'), r: data.last7Days },
    { key: '30d', label: tx('range30d'), r: data.last30Days },
    { key: 'month', label: tx('rangeMonth'), r: data.thisMonth },
  ];

  const footer = (
    <footer className="foot">
      <span>{tx('footTimezone', { tz: data.timezone ?? '—' })}</span>
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
  );

  const banners = (
    <>
      {data.warnings?.length > 0 && (
        <div className="banner warn">
          <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
          <div>
            {data.warnings.map((w, i) => (
              <div key={i}>
                {tx('warnPrefix')}
                {w}
              </div>
            ))}
          </div>
        </div>
      )}
      {filtered && (
        <div className="banner filter">
          <Filter size={14} strokeWidth={2} aria-hidden="true" />
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
    </>
  );

  if (totals.requests === 0) {
    return shell(
      <>
        {banners}
        <div className="state-card">
          <h1>
            <Inbox size={18} strokeWidth={2} aria-hidden="true" />
            {tx('emptyTitle')}
          </h1>
          <p>{coded(tx('emptyBody'))}</p>
        </div>
        {footer}
      </>,
    );
  }

  return shell(
    <>
      {banners}
      <section className="kpis" aria-label={tx('heroAria')}>
        <Stat
          label={tx('statTokens')}
          tone="lime"
          value={fmtTokens(totals.totalTokens)}
          sub={tx('statTokensSub', { requests: totals.requests ?? 0, sessions: totals.sessions ?? 0 })}
        />
        <Stat
          label={tx('statCost')}
          value={fmtCost(totals.costUsd)}
          sub={unpriced.length === 0 ? tx('statCostPriced') : unpriced.length === 1 ? tx('statCostUnpricedOne') : tx('statCostUnpriced', { n: unpriced.length })}
        />
        <Stat
          label={tx('statCache')}
          tone="green"
          value={fmtPct(data.cacheHitRate)}
          sub={tx('statCacheSub', { tokens: fmtTokens(totals.cacheReadTokens) })}
        />
        <Stat
          label={tx('statActiveDays')}
          value={data.activeDays ?? activeWindowDays}
          sub={data.activityRange?.firstAt ? tx('statActiveSince', { date: dateOnly(data.activityRange.firstAt) }) : '—'}
        />
      </section>

      <div className="sheet">
        <Cell
          title={tx('trendTitle')}
          desc={tx('trendDesc')}
          extra={
            <div className="range-chips">
              {rangeChips.map(({ key, label, r }) => (
                <span key={key} className="range-chip">
                  <span className="range-chip-label">{label}</span>
                  <b>{fmtTokens(r?.tokens ?? 0)}</b>
                  <span className="range-chip-cost">{fmtCost(r?.costUsd ?? 0)}</span>
                </span>
              ))}
            </div>
          }
        >
          <TrendChart
            trends={{ 7: data.trend7, 30: data.trend, 90: data.trend90 }}
            trendsByAgent={data.trendByAgent ?? {}}
            agents={agents.map((a) => ({ id: a.id, label: clientLabel(a.id) }))}
            locale={locale}
          />
        </Cell>

        <Cell title={tx('heatTitle')} desc={heatDesc}>
          <Heatmap heatmap={data.heatmap} locale={locale} />
        </Cell>

        <Cell title={tx('agentsTitle')} desc={tx('agentsDesc')} span={5}>
          <AgentsPanel
            agents={agents.map((a) => ({ ...a, label: clientLabel(a.id) }))}
            models={data.models ?? []}
            totals={{ totalTokens: totals.totalTokens, costUsd: totals.costUsd, cacheHitRate: data.cacheHitRate }}
            locale={locale}
          />
        </Cell>

        <Cell title={tx('modelTitle')} desc={tx('modelDesc')} span={7}>
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
        </Cell>

        <Cell title={tx('hourTitle')} desc={tx('hourDesc')} span={4}>
          <HourBars hourly={data.hourly} locale={locale} />
        </Cell>
        <Cell title={tx('monthTitle')} desc={tx('monthDesc')} span={4}>
          <MonthlyBars monthly={data.monthly} locale={locale} />
        </Cell>
        <Cell title={tx('rhythmTitle')} desc={tx('rhythmDesc')} span={4}>
          <Rhythm streaks={streaks} peakDay={peakDay} longest={longest} tx={tx} />
        </Cell>

        <Cell title={tx('sessTitle')} desc={tx('sessDesc')}>
          <SessionTable rows={topSessions} tx={tx} />
        </Cell>
      </div>
      {footer}
    </>,
  );
}
