'use client';

// SVG donut for share-by-client, with a legend carrying tokens and cost.

import { fmtTokens, fmtCost } from '@/lib/format';

const PALETTE = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f778ba', '#39c5cf', '#f85149'];
const R = 56;
const C = 2 * Math.PI * R;

export default function Donut({ items, centerValue, centerLabel }) {
  const total = items.reduce((s, x) => s + x.value, 0);
  let acc = 0;

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 160 160" className="donut" role="img" aria-label="Agent 占比">
        {total <= 0 ? (
          <circle cx="80" cy="80" r={R} fill="none" stroke="#1b2129" strokeWidth="22" />
        ) : (
          items.map((it, i) => {
            const frac = it.value / total;
            const dash = items.length === 1 ? `${C} ${C}` : `${Math.max(frac * C - 1.5, 0.5)} ${C}`;
            const el = (
              <circle
                key={it.name}
                cx="80"
                cy="80"
                r={R}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth="22"
                strokeDasharray={dash}
                strokeDashoffset={-acc * C}
                transform="rotate(-90 80 80)"
              />
            );
            acc += frac;
            return el;
          })
        )}
        <text x="80" y="76" textAnchor="middle" className="donut-big">
          {centerValue}
        </text>
        <text x="80" y="95" textAnchor="middle" className="donut-sub">
          {centerLabel}
        </text>
      </svg>
      <ul className="donut-legend">
        {items.length === 0 && <li className="muted">暂无数据</li>}
        {items.map((it, i) => (
          <li key={it.name}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="legend-name">{it.name}</span>
            <span className="legend-val">{fmtTokens(it.value)}</span>
            <span className="legend-cost">{fmtCost(it.costUsd)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
