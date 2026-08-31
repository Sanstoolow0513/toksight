'use client';

// Two compact bar histograms sharing one visual language: token volume by
// local hour of day, and by calendar month across the full data range.

import { fmtTokens, fmtCost } from '@/lib/format';

export function HourBars({ hourly }) {
  if (!hourly?.length) return <div className="muted">暂无数据</div>;
  const max = Math.max(...hourly.map((h) => h.tokens), 1);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    <div>
      <div className="bars bars-short">
        {hourly.map((h) => (
          <div
            key={h.hour}
            className="bar-col"
            title={`${pad(h.hour)}:00–${pad(h.hour)}:59\n${fmtTokens(h.tokens)} tokens · ${fmtCost(h.costUsd)}\n${h.requests} 次请求 · ${h.sessions} 会话`}
          >
            <div className="bar-solid" style={{ height: `${(h.tokens / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="axis">
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
          <span key={h}>{pad(h)}</span>
        ))}
      </div>
    </div>
  );
}

export function MonthlyBars({ monthly }) {
  const rows = (monthly ?? []).filter((m) => m.month && m.month !== 'unknown');
  if (!rows.length) return <div className="muted">暂无数据</div>;
  const max = Math.max(...rows.map((m) => m.tokens), 1);
  return (
    <div>
      <div className="bars bars-short months">
        {rows.map((m) => (
          <div
            key={m.month}
            className="bar-col"
            title={`${m.month}\n${fmtTokens(m.tokens)} tokens · ${fmtCost(m.costUsd)}\n${m.requests} 次请求 · ${m.sessions} 会话`}
          >
            <div className="bar-solid" style={{ height: `${(m.tokens / max) * 100}%` }} />
            <span className="bar-label">{m.month.slice(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
