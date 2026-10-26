import { fmtCost, fmtPct } from '@/lib/format';

const PART_KEYS = ['compInput', 'compCacheRead', 'compCacheWrite', 'compOutput'];
const AGENT_COLORS = new Set(['claude', 'codex', 'opencode', 'kimi', 'zcode']);

// Each agent keeps one color on every period, card and export; unknown ids
// share a neutral one.
export function agentStyle(id) {
  return { '--agent': `var(--agent-${AGENT_COLORS.has(id) ? id : 'other'})` };
}

export function AgentDot({ id }) {
  return <i className="swatch agent-dot" style={agentStyle(id)} aria-hidden="true" />;
}

// 100% stacked token mix of one row: input / cache read / cache write / output.
export function PartsBar({ parts }) {
  return (
    <span className="parts-bar" aria-hidden="true">
      {parts.map((part, i) => (part > 0 ? <i key={i} className={`swatch part-${i}`} style={{ flexGrow: part }} /> : null))}
    </span>
  );
}

export function PartsLegend({ tx, children }) {
  return (
    <div className="parts-legend">
      {PART_KEYS.map((key, i) => (
        <span key={key} className="legend-part">
          <i className={`swatch part-${i}`} />
          {tx(key)}
        </span>
      ))}
      {children}
    </div>
  );
}

// Cache hit as a short bar gauge.
export function CacheRing({ rate }) {
  if (rate == null) return <span className="cell-muted">—</span>;
  return (
    <span className="cache-cell">
      <span className="cache-ticks" style={{ '--value': Math.round(rate * 100) }} aria-hidden="true"><i /></span>
      {fmtPct(rate)}
    </span>
  );
}

// Unpriced rows say so instead of showing $0; a partly priced cost is
// marked with an asterisk that the card legend explains.
export function CostValue({ row, tx }) {
  if (row.pricing === 'none') return <span className="cell-value is-muted is-unpriced">{tx('rowUnpriced')}</span>;
  return (
    <span className="cell-value">
      {fmtCost(row.costUsd)}
      {row.pricing === 'partial' ? <sup className="partial-mark" title={tx('rowPartial')}>*</sup> : null}
    </span>
  );
}
