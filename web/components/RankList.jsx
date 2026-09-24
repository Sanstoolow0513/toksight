import { fmtCost, fmtInt, fmtMetric, fmtPct, fmtTokens } from '@/lib/format';

const PART_KEYS = ['compInput', 'compCacheRead', 'compCacheWrite', 'compOutput'];

export function costText(row, tx) {
  if (row.pricing === 'none') return tx('rowUnpriced');
  const cost = fmtCost(row.costUsd);
  return row.pricing === 'partial' ? `${cost} (${tx('rowPartial')})` : cost;
}

// Bar length is the row's share of the period total. In token mode the bar
// is split by token class; in cost mode it is one solid accent bar.
export function ShareBar({ share, parts, metric }) {
  return (
    <div className="rank-track">
      <div className={metric === 'cost' ? 'rank-fill is-cost' : 'rank-fill'} style={{ width: share > 0 ? `max(4px, ${share * 100}%)` : 0 }}>
        {metric === 'tokens' ? parts.map((part, i) => (part > 0 ? <i key={i} className={`part-${i}`} style={{ flexGrow: part }} /> : null)) : null}
      </div>
    </div>
  );
}

export function RankRow({ rank, name, mono = false, lead, extra, row, metric, tx, muted = false }) {
  const meta = [
    lead,
    extra,
    metric === 'cost' ? `${fmtTokens(row.totalTokens)} tokens` : costText(row, tx),
    row.cacheHitRate != null ? tx('rowCache', { pct: fmtPct(row.cacheHitRate) }) : null,
    tx('rowRequests', { n: fmtInt(row.requests) }),
    row.sessions ? tx('rowSessions', { n: fmtInt(row.sessions) }) : null,
  ].filter(Boolean);
  const value = metric === 'cost' && row.pricing === 'none' ? '—' : fmtMetric(row.value, metric);
  const cls = ['rank-row', rank != null && 'has-rank', muted && 'is-muted'].filter(Boolean).join(' ');
  return (
    <li className={cls}>
      <div className="rank-line">
        {rank != null ? <span className="rank-no">{rank}</span> : null}
        <span className={mono ? 'rank-name is-mono' : 'rank-name'} title={name}>
          {name}
        </span>
        <span className="rank-value">{value}</span>
        <span className="rank-share">{fmtPct(row.share)}</span>
      </div>
      <ShareBar share={row.share} parts={row.parts} metric={metric} />
      <div className="rank-meta">{meta.join(' · ')}</div>
    </li>
  );
}

export function PartsLegend({ tx }) {
  return (
    <div className="parts-legend">
      {PART_KEYS.map((key, i) => (
        <span key={key}>
          <i className={`part-${i}`} />
          {tx(key)}
        </span>
      ))}
    </div>
  );
}
