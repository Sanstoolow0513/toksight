'use client';

// Two compact bar histograms sharing one visual language: token volume by
// local hour of day, and by calendar month across the full data range.

import { fmtTokens, fmtCost } from '@/lib/format';
import { t } from '@/lib/i18n';

export function HourBars({ hourly, locale = 'zh-CN' }) {
  if (!hourly?.length) return <div className="muted">{t(locale, 'hourEmpty')}</div>;
  const max = Math.max(...hourly.map((h) => h.tokens), 1);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    <div>
      <div className="bars bars-short">
        {hourly.map((h) => (
          <div
            key={h.hour}
            className="bar-col"
            title={`${pad(h.hour)}:00–${pad(h.hour)}:59\n${fmtTokens(h.tokens)} tokens · ${fmtCost(h.costUsd)}\n${h.requests} · ${h.sessions}`}
          >
            <div className="bar-solid grow-y" style={{ height: `${(h.tokens / max) * 100}%`, '--d': `${h.hour * 18}ms` }} />
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

export function MonthlyBars({ monthly, locale = 'zh-CN' }) {
  const rows = (monthly ?? []).filter((m) => m.month && m.month !== 'unknown');
  if (!rows.length) return <div className="muted">{t(locale, 'monthEmpty')}</div>;
  const max = Math.max(...rows.map((m) => m.tokens), 1);
  return (
    <div>
      <div className="bars bars-short months">
        {rows.map((m, i) => (
          <div
            key={m.month}
            className="bar-col"
            title={`${m.month}\n${fmtTokens(m.tokens)} tokens · ${fmtCost(m.costUsd)}\n${m.requests} · ${m.sessions}`}
          >
            <div className="bar-solid grow-y" style={{ height: `${(m.tokens / max) * 100}%`, '--d': `${i * 40}ms` }} />
            <span className="bar-label">{m.month.slice(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
