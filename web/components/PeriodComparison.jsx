import { fmtCost, fmtTokens, fmtPct } from '@/lib/format';

function date(ts, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
}
const signed = (value, format) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}`;

export default function PeriodComparison({ comparison, timezone, tx, clientLabel }) {
  if (!comparison) return null;
  if (!comparison.available) return <section className="period-comparison"><h2>{tx('compareTitle')}</h2><p className="muted">{tx(comparison.reason === 'startup-range' ? 'compareRestricted' : 'compareEmptyRange')}</p></section>;
  const { current, previous, delta } = comparison;
  const unpriced = current.costCoverage.unpricedRequests + previous.costCoverage.unpricedRequests;
  const fallback = current.costCoverage.cacheFallbackRequests + previous.costCoverage.cacheFallbackRequests;
  const contributions = (rows, model) => <div className="table-scroll"><table className="tbl">
    <thead><tr><th>{tx(model ? 'thModel' : 'thAgent')}</th><th className="num">{tx('comparePrevious')}</th><th className="num">{tx('compareCurrent')}</th><th className="num">{tx('compareCostDelta')}</th><th className="num">{tx('compareTokenDelta')}</th></tr></thead>
    <tbody>{rows.slice(0, 8).map((row) => <tr key={`${row.client}/${row.model || ''}`}>
      <td>{model ? `${row.model} · ${clientLabel(row.client)}` : clientLabel(row.client)}</td>
      <td className="num">{fmtCost(row.previousCostUsd)}</td><td className="num">{fmtCost(row.currentCostUsd)}</td>
      <td className="num">{signed(row.costDelta, fmtCost)}</td><td className="num">{signed(row.tokenDelta, fmtTokens)}</td>
    </tr>)}</tbody>
  </table></div>;
  return <section className="period-comparison">
    <div className="cell-head"><h2>{tx('compareTitle')}</h2><span className="cell-desc">{tx('compareDays', { n: comparison.days })}</span></div>
    <p className="compare-window">{tx('compareCurrent')}: {date(current.since, timezone)} → {date(current.until, timezone)} · {tx('comparePrevious')}: {date(previous.since, timezone)} → {date(previous.until, timezone)}</p>
    <div className="compare-kpis">
      <div><span>{tx('compareCostDelta')}</span><b>{signed(delta.costUsd, fmtCost)}</b><small>{comparison.costChangePercent == null ? tx('compareNoBaseline') : signed(comparison.costChangePercent, fmtPct)}</small></div>
      <div><span>{tx('compareTokenDelta')}</span><b>{signed(delta.totalTokens, fmtTokens)}</b><small>{fmtTokens(previous.totals.totalTokens)} → {fmtTokens(current.totals.totalTokens)}</small></div>
      <div><span>{tx('statCache')}</span><b>{fmtPct(previous.cacheHitRate)} → {fmtPct(current.cacheHitRate)}</b><small>{tx('compareRequests', { previous: previous.totals.requests, current: current.totals.requests })}</small></div>
    </div>
    {comparison.partialCurrent && <p className="cost-caveat">{tx('comparePartial')}</p>}
    {(current.totals.requests === 0 || previous.totals.requests === 0) && <p className="muted">{tx('compareNoActivity')}</p>}
    {unpriced > 0 && <p className="cost-caveat">{tx('compareUnpriced', { n: unpriced })}</p>}
    {fallback > 0 && <p className="cost-caveat">{tx('costFallback', { n: fallback })}</p>}
    {comparison.untimestampedRequests > 0 && <p className="muted">{tx('compareUndated', { n: comparison.untimestampedRequests })}</p>}
    <p className="muted">{tx('compareMethod')}</p>
    {comparison.byClient.length > 0 && <details open><summary>{tx('compareByAgent')}</summary>{contributions(comparison.byClient, false)}</details>}
    {comparison.byModel.length > 0 && <details><summary>{tx('compareByModel')}</summary>{contributions(comparison.byModel, true)}</details>}
  </section>;
}
