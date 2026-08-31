'use client';

// Compact ranges table: today / 7d / 30d / this month as rows, with an
// inline share bar against the busiest range.

import { fmtTokens, fmtCost, fmtPct } from '@/lib/format';
import { t } from '@/lib/i18n';

export default function RangeTable({ data, totals, locale = 'zh-CN' }) {
  const rows = [
    { key: 'today', label: t(locale, 'rangeToday'), r: data?.today },
    { key: '7d', label: t(locale, 'range7d'), r: data?.last7Days },
    { key: '30d', label: t(locale, 'range30d'), r: data?.last30Days },
    { key: 'month', label: t(locale, 'rangeMonth'), r: data?.thisMonth },
  ];
  const grand = Number(totals?.totalTokens) || 0;
  const max = Math.max(...rows.map((x) => x.r?.tokens || 0), 1);

  return (
    <table className="tbl rtable">
      <thead>
        <tr>
          <th>{t(locale, 'rangeHeadRange')}</th>
          <th className="num">{t(locale, 'rangeHeadTokens')}</th>
          <th className="num">{t(locale, 'rangeHeadCost')}</th>
          <th className="num">{t(locale, 'rangeHeadSessions')}</th>
          <th className="num rt-share">{t(locale, 'rangeHeadShare')}</th>
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
