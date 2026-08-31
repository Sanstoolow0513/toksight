'use client';

// SVG donut for share-by-client, with a legend carrying tokens and cost.

import { fmtTokens, fmtCost } from '@/lib/format';
import { colorAt } from '@/lib/palette';
import { t } from '@/lib/i18n';

const R = 56;
const C = 2 * Math.PI * R;

export default function Donut({ items, centerValue, centerLabel, locale = 'zh-CN' }) {
  const total = items.reduce((s, x) => s + x.value, 0);
  let acc = 0;

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 160 160" className="donut" role="img" aria-label={t(locale, 'donutAria')}>
        {total <= 0 ? (
          <circle cx="80" cy="80" r={R} fill="none" stroke="var(--color-border)" strokeWidth="22" />
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
                stroke={colorAt(i)}
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
        <text x="80" y="96" textAnchor="middle" className="donut-sub">
          {centerLabel}
        </text>
      </svg>
      <ul className="donut-legend">
        {items.length === 0 && <li className="muted">{t(locale, 'donutEmpty')}</li>}
        {items.map((it, i) => (
          <li key={it.name}>
            <i style={{ background: colorAt(i) }} />
            <span className="legend-name">{it.name}</span>
            <span className="legend-val">{fmtTokens(it.value)}</span>
            <span className="legend-cost">{fmtCost(it.costUsd)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
