'use client';

// toksight dashboard — fluid layout (design-spec v4): two primary cards
// (activity + trend) set the visual weight, everything after them is a
// borderless block. Decorative icons are gone (icons only mark actions and
// states), numbers render instantly, and the nav badge states the last fetch
// time instead of claiming a live stream.
//   1. Activity card: compact stat strip + GitHub-style heatmap.
//   2. Trend card: range × mode (composition / agents) cross stats, with the
//      old ranges table folded in as summary chips.
//   3. Agent share + hit rate beside model usage with cache-read share
//      segmented into every bar — borderless blocks.
//   4. Hourly / monthly histograms — borderless blocks.
// The top-sessions table was dropped (API keeps `topSessions` for compat).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, RefreshCw, TriangleAlert, Filter } from 'lucide-react';
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

function Card({ title, desc, extra, children }) {
  return (
    <section className="card section">
      <div className="section-head">
        <h2>{title}</h2>
        {desc ? <span className="section-desc">{desc}</span> : null}
        {extra ? <div className="section-extra">{extra}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Block({ title, desc, extra, children }) {
  return (
    <section className="block">
      <div className="block-head">
        <h3>{title}</h3>
        {desc ? <span className="block-desc">{desc}</span> : null}
        {extra ? <div className="block-extra">{extra}</div> : null}
      </div>
      {children}
    </section>
  );
}

// Hero stat chip: label + value (+ optional sub line). Values render
// instantly — no count-up.
function StatChip({ label, value, sub, accent }) {
  return (
    <div className={accent ? 'chip accent' : 'chip'}>
      <div className="chip-body">
        <span className="chip-label">{label}</span>
        <span className="chip-value">{value}</span>
        {sub ? <span className="chip-sub">{sub}</span> : null}
      </div>
    </div>
  );
}

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
  // Heights approximate the real cards so the swap to data doesn't jump.
  return (
    <>
      <div className="skel-block" style={{ height: 560 }}>
        <div className="skel" style={{ height: 16, width: 140, marginBottom: 24 }} />
        <div className="skel" style={{ height: 84, marginBottom: 24 }} />
        <div className="skel" style={{ height: 400 }} />
      </div>
      <div className="skel-block" style={{ height: 420 }}>
        <div className="skel" style={{ height: 16, width: 140, marginBottom: 24 }} />
        <div className="skel" style={{ height: 340 }} />
      </div>
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
          {data && <span className="live-badge">{tx('live', { time: fmtDateTime(data.generatedAt) })}</span>}
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
  const streaks = data.streaks ?? {};
  const peakDay = data.peakDay;
  const filtered = Boolean(data.clientsFilter?.length || data.range?.since != null || data.range?.until != null);
  const heatDesc = [tx('heatDesc', { weeks: data.heatmap?.weeks ?? 53 }), activeWindowDays ? tx('heatActive', { n: activeWindowDays }) : null]
    .filter(Boolean)
    .join(' · ');

  const rangeChips = [
    { key: 'today', label: tx('rangeToday'), r: data.today },
    { key: '7d', label: tx('range7d'), r: data.last7Days },
    { key: '30d', label: tx('range30d'), r: data.last30Days },
    { key: 'month', label: tx('rangeMonth'), r: data.thisMonth },
  ];

  return (
    <>
      {nav}
      <div className="wrap">
        {data.warnings?.length > 0 && (
          <div className="warn">
            <TriangleAlert size={14} strokeWidth={2} />
            <div>
              {data.warnings.map((w, i) => (
                <div key={i}>
                  {tx('warnPrefix')}{w}
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
            <Card title={tx('heatTitle')} desc={heatDesc}>
              <div className="statstrip">
                <StatChip
                  label={tx('statTokens')}
                  value={fmtTokens(totals.totalTokens)}
                  sub={tx('statTokensSub', { requests: totals.requests ?? 0, sessions: totals.sessions ?? 0 })}
                />
                <StatChip
                  label={tx('statCost')}
                  value={fmtCost(totals.costUsd)}
                  sub={unpriced.length ? tx('statCostUnpriced', { n: unpriced.length }) : tx('statCostPriced')}
                />
                <StatChip
                  label={tx('statCache')}
                  accent
                  value={fmtPct(data.cacheHitRate)}
                  sub={tx('statCacheSub', { tokens: fmtTokens(totals.cacheReadTokens) })}
                />
                <StatChip
                  label={tx('statActiveDays')}
                  value={data.activeDays ?? activeWindowDays}
                  sub={data.activityRange?.firstAt ? tx('statActiveSince', { date: dateOnly(data.activityRange.firstAt) }) : '—'}
                />
                <StatChip
                  label={tx('statStreak')}
                  value={Number.isFinite(streaks.current) ? tx('statStreakValue', { n: streaks.current }) : '—'}
                  sub={Number.isFinite(streaks.longest) ? tx('statStreakLongest', { n: streaks.longest }) : null}
                />
                <StatChip
                  label={tx('statPeak')}
                  value={peakDay ? fmtTokens(peakDay.tokens) : '—'}
                  sub={peakDay?.date ?? null}
                />
                <StatChip
                  label={tx('statLongest')}
                  value={fmtDuration(longest?.activeMs)}
                  sub={
                    longest
                      ? `${clientLabel(longest.client)} · ${tx('statLongestSpan', { duration: fmtDuration(longest.durationMs) })}`
                      : '—'
                  }
                />
              </div>
              <Heatmap heatmap={data.heatmap} locale={locale} />
            </Card>

            <Card
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
            </Card>

            <div className="blocks">
              <Block title={tx('agentsTitle')} desc={tx('agentsDesc')}>
                <AgentsPanel
                  agents={agents.map((a) => ({ ...a, label: clientLabel(a.id) }))}
                  models={data.models ?? []}
                  totals={{ totalTokens: totals.totalTokens, costUsd: totals.costUsd, cacheHitRate: data.cacheHitRate }}
                  locale={locale}
                />
              </Block>
              <Block title={tx('modelTitle')} desc={tx('modelDesc')}>
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
              </Block>
            </div>

            <div className="blocks">
              <Block title={tx('hourTitle')} desc={tx('hourDesc')}>
                <HourBars hourly={data.hourly} locale={locale} />
              </Block>
              <Block title={tx('monthTitle')} desc={tx('monthDesc')}>
                <MonthlyBars monthly={data.monthly} locale={locale} />
              </Block>
            </div>
          </>
        )}

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
      </div>
    </>
  );
}
