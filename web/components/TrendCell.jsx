'use client';

// Trend cell: range segmented control data (today / 7d / 30d / month chips
// in the header's extra slot, hidden while a custom selection is active)
// plus the stepped stacked TrendChart. Kept out of app/page.js so the page
// stays data-assembly only.

import { fmtTokens, fmtCost } from '@/lib/format';
import Cell from '@/components/Cell';
import TrendChart from '@/components/TrendChart';
import { clientLabel } from '@/lib/clients';

export default function TrendCell({ data, agents, locale, tx }) {
  const rangeChips = [
    { key: 'today', label: tx('rangeToday'), r: data.today },
    { key: '7d', label: tx('range7d'), r: data.last7Days },
    { key: '30d', label: tx('range30d'), r: data.last30Days },
    { key: 'month', label: tx('rangeMonth'), r: data.thisMonth },
  ];
  return (
    <Cell
      title={tx('trendTitle')}
      desc={data.selection ? tx(data.selection.truncated ? 'selectedTruncated' : 'selectedCharts') : tx('trendDesc')}
      extra={!data.selection &&
        <div className="range-chips">
          {rangeChips.map(({ key, label, r }) => (
            <span key={key} className="range-chip">
              <span className="range-chip-label">{label}</span>
              <b>{fmtTokens(r?.tokens ?? 0)}</b>
              <span className="range-chip-cost">{fmtCost(r?.costUsd ?? 0)}</span>
            </span>
          ))}
        </div>
      }
    >
      <TrendChart
        selection={data.selection}
        trends={{ 7: data.trend7, 30: data.trend, 90: data.trend90 }}
        trendsByAgent={data.trendByAgent ?? {}}
        trendsByModel={data.trendByModel ?? {}}
        agents={agents.map((a) => ({ id: a.id, label: clientLabel(a.id) }))}
        locale={locale}
      />
    </Cell>
  );
}
