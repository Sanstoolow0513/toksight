import { ArrowDownRight, ArrowUpRight, Coins, Layers3, MessagesSquare, Zap } from 'lucide-react';
import { costPerMillion } from '@/lib/report';
import { fmtCost, fmtInt, fmtPct, fmtTokens } from '@/lib/format';

export default function Kpis({ data, tx, grid = false }) {
  const totals = data.totals ?? {};
  const unpriced = data.pricing?.unpricedModels ?? [];
  const rate = costPerMillion(totals);
  const previous = data.comparison?.available ? data.comparison.previous.totals : null;
  const items = [
    { kind: 'tokens', Icon: Layers3, label: tx('kpiTokens'), value: fmtTokens(totals.totalTokens),
      change: previous?.totalTokens > 0 ? (totals.totalTokens - previous.totalTokens) / previous.totalTokens : null,
      sub: tx('kpiTokensSub', { input: fmtTokens((totals.inputTokens ?? 0) + (totals.cacheReadTokens ?? 0) + (totals.cacheWriteTokens ?? 0)), output: fmtTokens(totals.outputTokens) }) },
    { kind: 'cost', Icon: Coins, label: tx('kpiCost'), value: totals.requests > 0 && !totals.pricedRequests ? tx('rowUnpriced') : fmtCost(totals.costUsd),
      change: previous?.costUsd > 0 && totals.pricedRequests === totals.requests && previous.pricedRequests === previous.requests ? (totals.costUsd - previous.costUsd) / previous.costUsd : null,
      sub: unpriced.length ? tx('kpiCostUnpriced', { n: unpriced.length }) : rate != null ? tx('kpiCostRate', { rate: fmtCost(rate) }) : tx('priceUnits') },
    { kind: 'cache', Icon: Zap, label: tx('kpiCache'), value: fmtPct(data.cacheHitRate), sub: tx('kpiCacheSub', { tokens: fmtTokens(totals.cacheReadTokens) }) },
    { kind: 'requests', Icon: MessagesSquare, label: tx('kpiRequests'), value: fmtInt(totals.requests), sub: tx('kpiRequestsSub', { n: fmtInt(totals.sessions) }) },
  ];
  return <dl className={'kpis' + (grid ? ' is-grid' : '')}>{items.map(({ kind, Icon, label, value, sub, change }) => <div key={kind} className={'kpi is-' + kind}>
    <dt><span>{label}</span><Icon size={17} strokeWidth={1.6} /></dt>
    <dd><div className="kpi-number"><span className="kpi-value">{value}</span>{change != null ? <span className="kpi-change" title={tx('compareFullDay')}>
      {change < 0 ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{fmtPct(Math.abs(change))}</span> : null}</div>
      <span className="kpi-sub">{sub}</span>
      <span className="kpi-caption">{change != null ? tx('compareFullDay') : tx('localRecord')}</span></dd>
  </div>)}</dl>;
}
