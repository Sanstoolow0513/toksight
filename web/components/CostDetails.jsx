import { fmtCost } from '@/lib/format';

export default function CostDetails({ coverage, pricing, tx }) {
  if (!coverage) return null;
  return <details className="cost-details">
    <summary>{tx('costExplainTitle')} · {tx('costCoverage', { priced: coverage.requests - coverage.unpricedRequests, total: coverage.requests })}</summary>
    <p>{tx('costExplainBody')}</p>
    <div className="table-scroll"><table className="tbl">
      <thead><tr><th>{tx('costSource')}</th><th>{tx('thRequests')}</th><th>{tx('statCost')}</th></tr></thead>
      <tbody>{Object.entries(coverage.sources).filter(([, row]) => row.requests > 0).map(([source, row]) => <tr key={source}>
        <td>{tx(`costSource_${source}`)}</td><td>{row.requests}</td><td>{fmtCost(row.costUsd)}</td>
      </tr>)}</tbody>
    </table></div>
    {coverage.unpricedRequests > 0 && <p className="cost-caveat">{tx('costUnpriced', { n: coverage.unpricedRequests, models: pricing.unpricedModels.join(', ') })}</p>}
    {coverage.cacheFallbackRequests > 0 && <p className="cost-caveat">{tx('costFallback', { n: coverage.cacheFallbackRequests })}</p>}
    <p>{tx('costOverrides')} <code>{pricing.configDir}</code></p>
  </details>;
}
