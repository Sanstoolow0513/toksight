'use client';

// Agent share block: one row per agent with a max-relative share bar (rank
// palette color, consistent with the trend "agent" mode — agents arrive
// sorted by volume), tokens/cost/share, and a thin green cache-hit-rate
// bar. Clicking a row expands that agent's per-model hit-rate breakdown.
// Hit rate is request-attributed: a session that switched models splits
// cleanly across model rows.

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fmtTokens, fmtCost, fmtPct } from '@/lib/format';
import { colorAt } from '@/lib/palette';
import { t } from '@/lib/i18n';

const hitWidth = (rate) => (rate == null ? '0%' : `${Math.max(rate * 100, 0.5)}%`);

function AgentRow({ agent, index, models, locale }) {
  const [open, setOpen] = useState(false);
  const maxTokens = agent.maxTokens || 1;
  const share = agent.grandTotal > 0 ? agent.totalTokens / agent.grandTotal : 0;
  const agentModels = useMemo(
    () => models.filter((m) => m.client === agent.id).sort((a, b) => b.totalTokens - a.totalTokens),
    [models, agent.id],
  );

  return (
    <div className={`arow${open ? ' open' : ''}`}>
      <button type="button" className="arow-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="arow-caret">
          <ChevronDown size={14} strokeWidth={2} />
        </span>
        <span className="arow-name">
          <i className="dot" style={{ background: colorAt(index) }} />
          {agent.label || agent.id}
        </span>
        <span className="arow-meta">
          <b>{fmtTokens(agent.totalTokens)}</b>
          <span className="arow-meta-extra"> · {fmtCost(agent.costUsd)} · {fmtPct(share, 0)}</span>
        </span>
        <span className="arow-hit">
          <span className="arow-hit-num" title={t(locale, 'agentHit')}>
            {fmtPct(agent.cacheHitRate)}
          </span>
          <span className="hitbar" title={t(locale, 'agentHit')}>
            <i style={{ width: hitWidth(agent.cacheHitRate) }} />
          </span>
        </span>
      </button>
      <div className="arow-bar" aria-hidden="true">
        <i
          style={{
            width: `${Math.max((agent.totalTokens / maxTokens) * 100, 1)}%`,
            '--bar-color': colorAt(index),
          }}
        />
      </div>
      <div className="arow-detail">
        <div className="arow-detail-inner">
          {agentModels.length ? (
            agentModels.map((m) => (
              <div className="arow-model" key={m.model}>
                <span className="arow-model-name mono">{m.model}</span>
                <span className="arow-model-meta">
                  <b>{fmtPct(m.cacheHitRate)}</b> · {t(locale, 'agentTokens', { tokens: fmtTokens(m.totalTokens) })} ·{' '}
                  {t(locale, 'agentReqs', { n: m.requests ?? 0 })}
                </span>
                <span className="hitbar">
                  <i style={{ width: hitWidth(m.cacheHitRate) }} />
                </span>
              </div>
            ))
          ) : (
            <div className="arow-model muted">{t(locale, 'agentNoModels')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgentsPanel({ agents = [], models = [], totals = {}, locale = 'zh-CN' }) {
  if (!agents.length) return <div className="muted">{t(locale, 'agentsEmpty')}</div>;
  const maxTokens = Math.max(...agents.map((a) => a.totalTokens), 1);
  const grandTotal = agents.reduce((s, a) => s + a.totalTokens, 0);

  return (
    <div className="alist" aria-label={t(locale, 'agentsAria')}>
      {agents.map((a, i) => (
        <AgentRow
          key={a.id}
          agent={{ ...a, maxTokens, grandTotal }}
          index={i}
          models={models}
          locale={locale}
        />
      ))}
      <div className="arow-total">
        <span aria-hidden="true" />
        <span>{t(locale, 'agentsTotal')}</span>
        <span className="arow-meta">
          <b>{fmtTokens(totals.totalTokens)}</b>
          <span className="arow-meta-extra"> · {fmtCost(totals.costUsd)}</span>
        </span>
        <span className="arow-hit">
          <span className="arow-hit-num" title={t(locale, 'agentHit')}>
            {fmtPct(totals.cacheHitRate)}
          </span>
        </span>
      </div>
    </div>
  );
}
