'use client';

// Two compact bar histograms sharing one visual language: token volume by
// local hour of day, and by calendar month across the full data range. Bars
// report through the shared Tip tooltip (mouse-anchored) instead of the
// native `title` attribute, so every chart on the page has the same
// instant-tooltip behavior. Hour axis labels sit at each tick's bar center
// ((h + 0.5) / 24), not spread evenly — space-between drifted a full slot
// by the right edge.

import { useState } from 'react';
import { fmtTokens, fmtCost } from '@/lib/format';
import { t } from '@/lib/i18n';
import Tip from '@/components/Tip';

function BarTip({ tip, locale, title }) {
  const tr = (key) => t(locale, key);
  return (
    <Tip x={tip.x} y={tip.y}>
      <div className="tip-title">{title}</div>
      <div className="tip-row">
        <span>{tr('heatTokens')}</span>
        <b>{fmtTokens(tip.row.tokens)}</b>
      </div>
      <div className="tip-row">
        <span>{tr('heatCost')}</span>
        <b>{fmtCost(tip.row.costUsd)}</b>
      </div>
      <div className="tip-row">
        <span>{tr('heatSessReq')}</span>
        <b>
          {tip.row.sessions} / {tip.row.requests}
        </b>
      </div>
    </Tip>
  );
}

export function HourBars({ hourly, locale = 'zh-CN' }) {
  const [tip, setTip] = useState(null);
  if (!hourly?.length) return <div className="muted">{t(locale, 'hourEmpty')}</div>;
  const max = Math.max(...hourly.map((h) => h.tokens), 1);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    <div onMouseLeave={() => setTip(null)}>
      <div className="bars bars-short">
        {hourly.map((h) => (
          <div key={h.hour} className="bar-col" onMouseEnter={(e) => setTip({ row: h, x: e.clientX, y: e.clientY })}>
            <div className="bar-solid" style={{ height: `${(h.tokens / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="axis">
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
          <span key={h} style={{ left: `${((h + 0.5) / 24) * 100}%` }}>
            {pad(h)}
          </span>
        ))}
      </div>
      {tip && <BarTip tip={tip} locale={locale} title={`${pad(tip.row.hour)}:00–${pad(tip.row.hour)}:59`} />}
    </div>
  );
}

export function MonthlyBars({ monthly, locale = 'zh-CN' }) {
  const [tip, setTip] = useState(null);
  const rows = (monthly ?? []).filter((m) => m.month && m.month !== 'unknown');
  if (!rows.length) return <div className="muted">{t(locale, 'monthEmpty')}</div>;
  const max = Math.max(...rows.map((m) => m.tokens), 1);
  return (
    <div onMouseLeave={() => setTip(null)}>
      <div className="bars bars-short months">
        {rows.map((m) => (
          <div key={m.month} className="bar-col" onMouseEnter={(e) => setTip({ row: m, x: e.clientX, y: e.clientY })}>
            <div className="bar-solid" style={{ height: `${(m.tokens / max) * 100}%` }} />
            <span className="bar-label">{m.month.slice(2)}</span>
          </div>
        ))}
      </div>
      {tip && <BarTip tip={tip} locale={locale} title={tip.row.month} />}
    </div>
  );
}
