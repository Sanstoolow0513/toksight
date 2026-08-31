'use client';

// Recent daily trend as stacked CSS bars: fresh input (bottom), cache reads
// (middle), output (top). Gap days are zero-filled by the API payload.

import { fmtTokens, fmtCost } from '@/lib/format';

const CLASSES = [
  { key: 'input', label: '新输入', color: '#58a6ff' },
  { key: 'cacheRead', label: '缓存读取', color: '#3fb950' },
  { key: 'output', label: '输出', color: '#d29922' },
];

export default function TrendChart({ trend }) {
  if (!trend?.length) return <div className="muted">暂无数据</div>;
  const max = Math.max(...trend.map((d) => d.tokens), 1);

  return (
    <div>
      <div className="bars bars-tall">
        {trend.map((d) => (
          <div
            key={d.date}
            className="bar-col"
            title={`${d.date}\n${CLASSES.map((c) => `${c.label} ${fmtTokens(d[c.key])}`).join(' · ')}\n合计 ${fmtTokens(d.tokens)} tokens · ${fmtCost(d.costUsd)} · ${d.sessions} 会话`}
          >
            <div className="bar-stack" style={{ height: `${(d.tokens / max) * 100}%` }}>
              {CLASSES.map((c) => (
                <span key={c.key} style={{ height: `${(d[c.key] / Math.max(d.tokens, 1)) * 100}%`, background: c.color }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="axis">
        <span>{trend[0]?.date.slice(5)}</span>
        <span>{trend[Math.floor(trend.length / 2)]?.date.slice(5)}</span>
        <span>{trend[trend.length - 1]?.date.slice(5)}</span>
      </div>
      <div className="legend-row">
        {CLASSES.map((c) => (
          <span key={c.key}>
            <i style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
