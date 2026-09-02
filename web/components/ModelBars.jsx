'use client';

// Ranked model list, aggregated across agents. Each bar is two sibling hard
// segments: green cache-read, then rank-color fresh traffic (fresh input +
// cache write + output). No CSS gradient — Brutalism only allows a hard split.

import { useMemo } from 'react';
import { fmtTokens, fmtCost, fmtPct } from '@/lib/format';
import { colorAt } from '@/lib/palette';
import { t } from '@/lib/i18n';

export default function ModelBars({ models = [], totalTokens = 0, limit = 8, locale = 'zh-CN' }) {
  const { rows, rest } = useMemo(() => {
    const merged = new Map();
    for (const m of models) {
      const row =
        merged.get(m.model) ||
        { model: m.model, tokens: 0, cacheRead: 0, costUsd: 0, requests: 0, clients: new Set() };
      row.tokens += m.totalTokens || 0;
      row.cacheRead += m.cacheReadTokens || 0;
      row.costUsd += m.costUsd || 0;
      row.requests += m.requests || 0;
      row.clients.add(m.client);
      merged.set(m.model, row);
    }
    const sorted = [...merged.values()].sort((a, b) => b.tokens - a.tokens || b.costUsd - a.costUsd);
    return { rows: sorted.slice(0, limit), rest: sorted.slice(limit) };
  }, [models, limit]);

  if (!rows.length) return <div className="muted">{t(locale, 'modelEmpty')}</div>;
  const max = Math.max(...rows.map((r) => r.tokens), 1);
  const restTokens = rest.reduce((s, r) => s + r.tokens, 0);

  return (
    <div className="mlist">
      {rows.map((r, i) => {
        const share = totalTokens > 0 ? r.tokens / totalTokens : 0;
        const cacheFrac = r.tokens > 0 ? Math.min(r.cacheRead / r.tokens, 1) : 0;
        return (
          <div className="mrow" key={r.model}>
            <div className="mrow-top">
              <span className="mrow-name mono">
                <i className="mrow-dot" style={{ background: colorAt(i) }} />
                {r.model}
                <span className="mrow-clients">{[...r.clients].join(' / ')}</span>
              </span>
              <span className="mrow-meta">
                <b>{fmtTokens(r.tokens)}</b> tokens · {fmtCost(r.costUsd)} · {fmtPct(share)}{' '}
                <em className="cache-badge">{t(locale, 'modelCacheShare', { pct: fmtPct(cacheFrac, 0) })}</em>
              </span>
            </div>
            <div className="mrow-bar">
              <span className="mrow-fill" style={{ width: `${Math.max((r.tokens / max) * 100, 1)}%` }}>
                <i className="mrow-cache" style={{ width: `${(cacheFrac * 100).toFixed(2)}%` }} />
                <i className="mrow-fresh" style={{ background: colorAt(i) }} />
              </span>
            </div>
          </div>
        );
      })}
      {rest.length > 0 && (
        <div className="mrow mrow-rest">
          <div className="mrow-top">
            <span className="mrow-name">{t(locale, 'modelRest', { n: rest.length })}</span>
            <span className="mrow-meta">
              <b>{fmtTokens(restTokens)}</b> tokens
            </span>
          </div>
        </div>
      )}
      <div className="legend-row model-legend">
        <span>
          <i className="seg-cache" />
          {t(locale, 'modelLegendCache')}
        </span>
        <span>
          <i className="seg-fresh" />
          <i className="seg-fresh-dim" />
          {t(locale, 'modelLegendFresh')}
        </span>
        <span className="legend-note">{t(locale, 'rankNote')}</span>
      </div>
    </div>
  );
}
