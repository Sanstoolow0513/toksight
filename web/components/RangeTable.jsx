'use client';

// Cursor-style compact ranges table: today / 7d / 30d / this month as rows
// (not big KPI cards), with an inline share bar against the busiest range.

import { fmtTokens, fmtCost, fmtPct } from '@/lib/format';

export default function RangeTable({ data, totals }) {
  const rows = [
    { key: 'today', label: '今日', r: data?.today },
    { key: '7d', label: '近 7 天', r: data?.last7Days },
    { key: '30d', label: '近 30 天', r: data?.last30Days },
    { key: 'month', label: '本月', r: data?.thisMonth },
  ];
  const grand = Number(totals?.totalTokens) || 0;
  const max = Math.max(...rows.map((x) => x.r?.tokens || 0), 1);

  return (
    <table className="tbl rtable">
      <thead>
        <tr>
          <th>范围</th>
          <th className="num">Tokens</th>
          <th className="num">费用</th>
          <th className="num">会话</th>
          <th className="num rt-share">占全部</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, label, r }) => {
          const tokens = r?.tokens ?? 0;
          const share = grand > 0 ? tokens / grand : 0;
          return (
            <tr key={key}>
              <td>{label}</td>
              <td className="num">{fmtTokens(tokens)}</td>
              <td className="num dim">{fmtCost(r?.costUsd ?? 0)}</td>
              <td className="num dim">{r?.sessions ?? 0}</td>
              <td className="num rt-share">
                <span className="rt-bar">
                  <i style={{ width: `${Math.max((tokens / max) * 100, tokens > 0 ? 2 : 0)}%` }} />
                </span>
                <span className="rt-pct">{fmtPct(share, 0)}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
