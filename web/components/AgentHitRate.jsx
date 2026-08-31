'use client';

// Per-agent cache hit rate. The "all" tab compares every agent's hit rate on
// one absolute 0–100% scale (click a row to drill in); an agent tab shows the
// big rate plus that agent's per-model breakdown. Data: payload.clients rows
// (per-agent totals incl. cacheHitRate) and payload.models (per client×model,
// already carrying cacheHitRate) — hit rate is request-attributed, so a
// session that switched models is simply split across rows, never miscounted.

import { useMemo, useState } from 'react';
import { fmtTokens, fmtPct } from '@/lib/format';
import { colorAt } from '@/lib/palette';
import { t } from '@/lib/i18n';

const barWidth = (rate) => (rate == null ? '0%' : `${Math.max(rate * 100, 0.5)}%`);

export default function AgentHitRate({ agents = [], models = [], locale = 'zh-CN' }) {
  const [active, setActive] = useState('all');
  // After a refresh the selected agent may vanish (e.g. filter change) — fall back.
  const selected = agents.some((a) => a.id === active) ? active : 'all';

  const agentRows = useMemo(
    () => models.filter((m) => m.client === selected).sort((a, b) => b.totalTokens - a.totalTokens),
    [models, selected],
  );

  if (!agents.length) return <div className="muted">{t(locale, 'agentEmpty')}</div>;

  const agent = agents.find((a) => a.id === selected);

  return (
    <div>
      <div className="seg" role="tablist" aria-label={t(locale, 'agentAria')}>
        <button
          type="button"
          role="tab"
          aria-selected={selected === 'all'}
          className={selected === 'all' ? 'on' : ''}
          onClick={() => setActive('all')}
        >
          {t(locale, 'agentAll')}
        </button>
        {agents.map((a, i) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={selected === a.id}
            className={selected === a.id ? 'on' : ''}
            onClick={() => setActive(a.id)}
          >
            <i className="mrow-dot" style={{ background: colorAt(i) }} />
            {a.label || a.id}
          </button>
        ))}
      </div>

      {selected === 'all' ? (
        <div className="mlist agent-list">
          {agents.map((a, i) => (
            <button type="button" className="agent-row" key={a.id} onClick={() => setActive(a.id)}>
              <div className="mrow-top">
                <span className="mrow-name">
                  <i className="mrow-dot" style={{ background: colorAt(i) }} />
                  {a.label || a.id}
                  <span className="mrow-clients">{t(locale, 'agentTokens', { tokens: fmtTokens(a.totalTokens) })}</span>
                </span>
                <span className="mrow-meta">
                  <b>{fmtPct(a.cacheHitRate)}</b> · {t(locale, 'agentReqs', { n: a.requests ?? 0 })}
                </span>
              </div>
              <div className="mrow-bar">
                <i style={{ width: barWidth(a.cacheHitRate), '--bar-color': 'var(--color-success)' }} />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="agent-detail">
          <div className="agent-kpi">
            <div className="agent-kpi-value">{fmtPct(agent.cacheHitRate)}</div>
            <div className="agent-kpi-sub">
              {t(locale, 'agentKpiSub', {
                read: fmtTokens(agent.cacheReadTokens),
                input: fmtTokens(agent.inputTokens),
                requests: agent.requests ?? 0,
              })}
            </div>
          </div>
          {agentRows.length ? (
            <div className="mlist">
              {agentRows.map((m) => (
                <div className="mrow" key={m.model}>
                  <div className="mrow-top">
                    <span className="mrow-name mono">{m.model}</span>
                    <span className="mrow-meta">
                      <b>{fmtPct(m.cacheHitRate)}</b> · {t(locale, 'agentTokens', { tokens: fmtTokens(m.totalTokens) })}
                    </span>
                  </div>
                  <div className="mrow-bar">
                    <i style={{ width: barWidth(m.cacheHitRate), '--bar-color': 'var(--color-success)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">{t(locale, 'agentNoModels')}</div>
          )}
        </div>
      )}
    </div>
  );
}
