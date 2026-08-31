'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtTokens, fmtCost, fmtPct, fmtDateTime, fmtDuration } from '@/lib/format';
import Heatmap from '@/components/Heatmap';
import TrendChart from '@/components/TrendChart';
import Donut from '@/components/Donut';
import { HourBars, MonthlyBars } from '@/components/Bars';

const CLIENT_LABELS = {
  zcode: 'ZCode',
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
};

function Section({ title, desc, children }) {
  return (
    <section className="card section">
      <div className="section-head">
        <h2>{title}</h2>
        {desc ? <span className="section-desc">{desc}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
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

export default function Page() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      if (!res.ok) throw new Error(`API 返回 ${res.status}`);
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
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [auto, load]);

  const agents = useMemo(() => {
    if (!data?.clients) return [];
    return Object.entries(data.clients)
      .map(([id, t]) => ({ id, ...t }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }, [data]);

  if (error && !data) {
    return (
      <div className="wrap">
        <div className="card error-card">
          <h1>无法加载 toksight 数据</h1>
          <p>
            <code>/api/data</code> 请求失败：{error}
          </p>
          <p>
            请通过 <code>toksight web</code> 打开本页面。开发模式下先运行{' '}
            <code>node bin/toksight.js web --api-only</code>，再执行 <code>npm run web:dev</code>。
          </p>
          <button className="btn" onClick={load}>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="wrap">
        <p className="muted center">加载中…</p>
      </div>
    );
  }

  const t = data.totals ?? {};
  const unpriced = data.pricing?.unpricedModels ?? [];
  const longest = data.longestSession;
  const topAgent = agents[0];
  const heatDays = data.heatmap?.days ?? [];
  const activeDays = heatDays.filter((d) => d.tokens > 0).length;
  const peak = heatDays.reduce((best, d) => (!best || d.tokens > best.tokens ? d : best), null);
  const filtered = Boolean(data.clientsFilter?.length || data.range?.since != null || data.range?.until != null);

  return (
    <div className="wrap">
      <header className="head">
        <div>
          <h1 className="logo">
            toksight<span className="logo-dot">.</span>
          </h1>
          <p className="head-sub">AI agent token 用量仪表盘{data.timezone ? ` · ${data.timezone}` : ''}</p>
        </div>
        <div className="head-actions">
          <label className="auto-label">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            自动刷新
          </label>
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>

      {data.warnings?.length > 0 && (
        <div className="warn">
          {data.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {filtered && (
        <div className="filter-note">
          生效筛选：
          {[
            data.clientsFilter?.length ? `client = ${data.clientsFilter.map(clientLabel).join(', ')}` : null,
            data.range?.since != null ? `since ${fmtDateTime(data.range.since).slice(0, 10)}` : null,
            data.range?.until != null ? `until ${fmtDateTime(data.range.until).slice(0, 10)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}

      {t.requests === 0 ? (
        <div className="card error-card">
          <h1>未找到会话数据</h1>
          <p>先用你的 AI agent 跑几个会话，稍后刷新本页。也可以在终端运行 <code>toksight env</code> 查看各 agent 的扫描位置，或用 <code>--client</code> / <code>--since</code> 调整筛选。</p>
        </div>
      ) : (
        <>
          <div className="kpis">
            <Kpi label="今日" value={fmtTokens(data.today?.tokens)} sub={`${fmtCost(data.today?.costUsd)} · ${data.today?.sessions ?? 0} 会话`} />
            <Kpi label="近 7 天" value={fmtTokens(data.last7Days?.tokens)} sub={`${fmtCost(data.last7Days?.costUsd)} · ${data.last7Days?.sessions ?? 0} 会话`} />
            <Kpi label="本月" value={fmtTokens(data.thisMonth?.tokens)} sub={`${fmtCost(data.thisMonth?.costUsd)} · ${data.thisMonth?.sessions ?? 0} 会话`} />
            <Kpi label="全部 Tokens" value={fmtTokens(t.totalTokens)} sub={`${t.requests ?? 0} 次请求 · ${t.sessions ?? 0} 会话`} />
            <Kpi label="全部费用" value={fmtCost(t.costUsd)} sub={unpriced.length ? `${unpriced.length} 个模型未定价` : '全部模型已定价'} />
            <Kpi label="缓存命中率" value={fmtPct(data.cacheHitRate)} accent="var(--green)" sub={`缓存读 ${fmtTokens(t.cacheReadTokens)} tokens`} />
            <Kpi
              label="最长会话"
              value={fmtDuration(longest?.durationMs)}
              sub={longest ? `${clientLabel(longest.client)} · ${fmtTokens(longest.totalTokens)} tokens` : '—'}
            />
            <Kpi
              label="最活跃 Agent"
              value={topAgent ? clientLabel(topAgent.id) : '—'}
              sub={topAgent ? `${fmtTokens(topAgent.totalTokens)} tokens · ${fmtCost(topAgent.costUsd)}` : '—'}
            />
          </div>

          <Section
            title="活动热力图"
            desc={`近 ${data.heatmap?.weeks ?? 53} 周 · 每日 tokens${activeDays ? ` · ${activeDays} 天有活动` : ''}${peak && peak.tokens > 0 ? ` · 峰值 ${peak.date}（${fmtTokens(peak.tokens)}）` : ''}`}
          >
            <Heatmap heatmap={data.heatmap} />
          </Section>

          <div className="grid-2">
            <Section title="近 30 天趋势" desc="按天堆叠 tokens">
              <TrendChart trend={data.trend} />
            </Section>
            <Section title="Agent 分布" desc="按 tokens 占比">
              <Donut
                items={agents.map((a) => ({ name: clientLabel(a.id), value: a.totalTokens, costUsd: a.costUsd }))}
                centerValue={fmtTokens(t.totalTokens)}
                centerLabel="全部 tokens"
              />
            </Section>
          </div>

          <div className="grid-2">
            <Section title="按小时分布" desc="当地时间 · tokens">
              <HourBars hourly={data.hourly} />
            </Section>
            <Section title="按月分布" desc="全部历史 · tokens">
              <MonthlyBars monthly={data.monthly} />
            </Section>
          </div>

          <Section title="模型明细" desc="按费用排序">
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>Agent</th>
                    <th className="num">请求</th>
                    <th className="num">输入</th>
                    <th className="num">缓存读</th>
                    <th className="num">缓存写</th>
                    <th className="num">输出</th>
                    <th className="num">命中率</th>
                    <th className="num">费用</th>
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
          </Section>

          <Section title="会话 Top" desc={`按 tokens 排序 · 前 ${data.topSessions?.length ?? 0} 个`}>
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>会话</th>
                    <th>Agent</th>
                    <th>模型</th>
                    <th>开始时间</th>
                    <th className="num">时长</th>
                    <th className="num">Tokens</th>
                    <th className="num">费用</th>
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
          统计范围：
          {data.activityRange?.firstAt ? `${fmtDateTime(data.activityRange.firstAt)} → ${fmtDateTime(data.activityRange.lastAt)}` : '—'}
        </span>
        <span>生成于 {fmtDateTime(data.generatedAt)}</span>
        {unpriced.length > 0 && <span>未定价模型（按 0 计费）：{unpriced.join(', ')}</span>}
        <span>toksight v{data.version} · 本地优先，数据不出你的机器</span>
      </footer>
    </div>
  );
}
