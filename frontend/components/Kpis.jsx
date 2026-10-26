import { Coins, Layers3, MessagesSquare, Zap } from 'lucide-react';
import { costPerMillion } from '@/lib/report';
import { fmtCost, fmtInt, fmtPct, fmtTokens } from '@/lib/format';
import { Stat } from './ui';

// The four readouts of a day or range, as one strip divided by hairlines.
export default function Kpis({ data, tx, size = 'md', grid = false }) {
  const totals = data.totals ?? {};
  const unpriced = data.pricing?.unpricedModels ?? [];
  const rate = costPerMillion(totals);
  const previous = data.comparison?.available ? data.comparison.previous.totals : null;
  const unpricedCost = totals.requests > 0 && !totals.pricedRequests;
  const items = [
    { kind: 'tokens', Icon: Layers3, label: tx('kpiTokens'), value: fmtTokens(totals.totalTokens),
      change: previous?.totalTokens > 0 ? (totals.totalTokens - previous.totalTokens) / previous.totalTokens : null,
      sub: tx('kpiTokensSub', { input: fmtTokens((totals.inputTokens ?? 0) + (totals.cacheReadTokens ?? 0) + (totals.cacheWriteTokens ?? 0)), output: fmtTokens(totals.outputTokens) }) },
    { kind: 'cost', Icon: Coins, label: tx('kpiCost'), value: unpricedCost ? tx('rowUnpriced') : fmtCost(totals.costUsd), textValue: unpricedCost,
      change: previous?.costUsd > 0 && totals.pricedRequests === totals.requests && previous.pricedRequests === previous.requests ? (totals.costUsd - previous.costUsd) / previous.costUsd : null,
      sub: unpriced.length ? tx('kpiCostUnpriced', { n: unpriced.length }) : rate != null ? tx('kpiCostRate', { rate: fmtCost(rate) }) : tx('priceUnits') },
    { kind: 'cache', Icon: Zap, label: tx('kpiCache'), value: fmtPct(data.cacheHitRate), sub: tx('kpiCacheSub', { tokens: fmtTokens(totals.cacheReadTokens) }) },
    { kind: 'requests', Icon: MessagesSquare, label: tx('kpiRequests'), value: fmtInt(totals.requests), sub: tx('kpiRequestsSub', { n: fmtInt(totals.sessions) }) },
  ];
  return <dl className={'kpis readouts plate' + (grid ? ' is-grid' : '')}>{items.map(({ kind, Icon, label, value, textValue, sub, change }) => <Stat key={kind} className={'kpi is-' + kind}
    size={size} label={label} icon={<Icon size={15} strokeWidth={1.6} aria-hidden="true" />} value={value} textValue={textValue} scale={size === 'lg'}
    delta={change != null ? { dir: change < 0 ? 'down' : 'up', text: fmtPct(Math.abs(change)), title: tx('compareFullDay') } : null}
    sub={sub} caption={change != null ? tx('compareFullDay') : tx('localRecord')} />)}</dl>;
}
