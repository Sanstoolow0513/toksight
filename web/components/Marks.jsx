import { fmtCost, fmtPct } from '@/lib/format';

const PART_KEYS = ['compInput', 'compCacheRead', 'compCacheWrite', 'compOutput'];
const AGENT_COLORS = new Set(['claude', 'codex', 'cursor', 'opencode', 'kimi', 'zcode']);

// Each agent keeps one color on every period, card and export; unknown ids
// share a neutral one.
export function agentStyle(id) {
  return { '--agent': `var(--agent-${AGENT_COLORS.has(id) ? id : 'other'})` };
}

export function AgentDot({ id }) {
  return <i className="agent-dot" style={agentStyle(id)} aria-hidden="true" />;
}

// 100% stacked token mix of one row: input / cache read / cache write / output.
export function PartsBar({ parts }) {
  return (
    <span className="parts-bar" aria-hidden="true">
      {parts.map((part, i) => (part > 0 ? <i key={i} className={`part-${i}`} style={{ flexGrow: part }} /> : null))}
    </span>
  );
}

export function PartsLegend({ tx, children }) {
  return (
    <div className="parts-legend">
      {PART_KEYS.map((key, i) => (
        <span key={key} className="legend-part">
          <i className={`part-${i}`} />
          {tx(key)}
        </span>
      ))}
      {children}
    </div>
  );
}

export function CacheRing({ rate }) {
  if (rate == null) return <span className="cell-muted">—</span>;
  return (
    <span className="cache-cell">
      <svg className="cache-ring" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <circle cx="8" cy="8" r="6" pathLength="100" strokeDasharray={`${rate * 100} 100`} transform="rotate(-90 8 8)" />
      </svg>
      {fmtPct(rate)}
    </span>
  );
}

// Unpriced rows say so instead of showing $0; a partly priced cost is
// marked with an asterisk that the card legend explains.
export function CostValue({ row, tx }) {
  if (row.pricing === 'none') return <span className="cell-value is-muted">{tx('rowUnpriced')}</span>;
  return (
    <span className="cell-value">
      {fmtCost(row.costUsd)}
      {row.pricing === 'partial' ? <sup className="partial-mark" title={tx('rowPartial')}>*</sup> : null}
    </span>
  );
}
