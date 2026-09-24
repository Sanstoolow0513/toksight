import { Coins, Layers, MessagesSquare, Zap } from 'lucide-react';
import { costPerMillion } from '@/lib/report';
import { fmtCost, fmtInt, fmtPct, fmtTokens } from '@/lib/format';

const ICONS = { tokens: Layers, cost: Coins, cache: Zap, requests: MessagesSquare };

// The four headline numbers, shared by the report (one strip) and the day
// card (2×2 grid). Tokens and cost always appear together.
export default function Kpis({ data, tx, grid = false }) {
  const totals = data.totals ?? {};
  const unpriced = data.pricing?.unpricedModels ?? [];
  const rate = costPerMillion(totals);
  const items = [
    {
      kind: 'tokens',
      label: tx('kpiTokens'),
      value: fmtTokens(totals.totalTokens),
      sub: tx('kpiTokensSub', {
        input: fmtTokens((totals.inputTokens ?? 0) + (totals.cacheReadTokens ?? 0) + (totals.cacheWriteTokens ?? 0)),
        output: fmtTokens(totals.outputTokens),
      }),
    },
    {
      kind: 'cost',
      label: tx('kpiCost'),
      value: fmtCost(totals.costUsd),
      sub: unpriced.length ? tx('kpiCostUnpriced', { n: unpriced.length }) : rate != null ? tx('kpiCostRate', { rate: fmtCost(rate) }) : null,
    },
    { kind: 'cache', label: tx('kpiCache'), value: fmtPct(data.cacheHitRate), sub: tx('kpiCacheSub', { tokens: fmtTokens(totals.cacheReadTokens) }) },
    { kind: 'requests', label: tx('kpiRequests'), value: fmtInt(totals.requests), sub: tx('kpiRequestsSub', { n: fmtInt(totals.sessions) }) },
  ];
  return (
    <dl className={grid ? 'kpis is-grid' : 'kpis'}>
      {items.map(({ kind, label, value, sub }) => {
        const Icon = ICONS[kind];
        return (
          <div key={kind} className={`kpi is-${kind}`}>
            <dt>
              <span className="kpi-icon">
                <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
              </span>
              {label}
            </dt>
            <dd>
              <span className="kpi-value">{value}</span>
              {sub ? <span className="kpi-sub">{sub}</span> : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
