'use client';

// GitHub-style activity heatmap: whole weeks as columns starting on Sunday,
// one row per weekday, ending today (partial last column). Tokens per local
// day drive a 5-step lime ramp. Cells are squares with a 2px gutter (worksheet
// grid, not GitHub's rounded 4px pitch).

import { useEffect, useRef, useState } from 'react';
import { fmtTokens, fmtCost } from '@/lib/format';
import { HEAT_MONTHS, HEAT_WEEKDAYS, t } from '@/lib/i18n';
import Tip from '@/components/Tip';

const CELL = 12;
const GAP = 2;
const PITCH = CELL + GAP;
const LABEL_X = 48;
const TOP = 16;

function levelOf(tokens, max) {
  if (tokens <= 0 || max <= 0) return 0;
  const r = tokens / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

function weekdayOf(date) {
  return new Date(Date.parse(`${date}T00:00:00`)).getDay();
}

export default function Heatmap({ heatmap, locale = 'zh-CN' }) {
  const [tip, setTip] = useState(null);
  const scrollRef = useRef(null);
  const didInitialScroll = useRef(false);
  const tr = (key, vars) => t(locale, key, vars);
  // API responses replace `heatmap`; only the first rendered grid should
  // reset to the newest week, not every refresh.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && !didInitialScroll.current) {
      el.scrollLeft = el.scrollWidth;
      didInitialScroll.current = true;
    }
  }, [heatmap]);
  if (!heatmap?.days?.length) return <div className="muted">{tr('heatEmpty')}</div>;

  const months = HEAT_MONTHS[locale] ?? HEAT_MONTHS['zh-CN'];
  const weekdays = HEAT_WEEKDAYS[locale] ?? HEAT_WEEKDAYS['zh-CN'];
  const { days, maxTokens } = heatmap;
  const cols = [];
  for (let i = 0; i < days.length; i += 7) cols.push(days.slice(i, i + 7));

  const monthLabels = [];
  cols.forEach((col, ci) => {
    const firstOfMonth = col.find((d) => d.date.endsWith('-01'));
    if (firstOfMonth) {
      monthLabels.push({ x: LABEL_X + ci * PITCH, label: months[Number(firstOfMonth.date.slice(5, 7)) - 1] });
    }
  });

  const width = LABEL_X + cols.length * PITCH + 8;
  const height = TOP + 7 * PITCH + 8;

  return (
    <div className="hm" onMouseLeave={() => setTip(null)}>
      <div className="hm-scroll" ref={scrollRef}>
        <svg width={width} height={height} role="img" aria-label={tr('heatAria')}>
          {monthLabels.map((m) => (
            <text key={m.label + m.x} x={m.x} y="12" className="hm-text">
              {m.label}
            </text>
          ))}
          {weekdays.map((w, i) =>
            i % 2 === 1 ? (
              <text key={i} x={LABEL_X - 8} y={TOP + i * PITCH + CELL} textAnchor="end" className="hm-text">
                {w}
              </text>
            ) : null,
          )}
          {cols.map((col, ci) =>
            col.map((d, ri) => {
              const level = levelOf(d.tokens, maxTokens);
              return (
                <rect
                  key={d.date}
                  x={LABEL_X + ci * PITCH}
                  y={TOP + ri * PITCH}
                  width={CELL}
                  height={CELL}
                  shapeRendering="crispEdges"
                  className={`heat-${level}${d.tokens > 0 ? '' : ' heat-empty'}`}
                  onMouseEnter={(e) => setTip({ d, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setTip((cur) => (cur && cur.d === d ? cur : { d, x: e.clientX, y: e.clientY }))}
                />
              );
            }),
          )}
        </svg>
      </div>
      <div className="hm-legend">
        <span>{tr('heatLess')}</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <i key={n} className={`heat-${n}`} />
        ))}
        <span>{tr('heatMore')}</span>
      </div>
      {tip && (
        <Tip x={tip.x} y={tip.y}>
          <div className="tip-title">
            {tip.d.date} · {tr('heatWeekday', { day: weekdays[weekdayOf(tip.d.date)] })}
          </div>
          <div className="tip-row">
            <span>{tr('heatTokens')}</span>
            <b>{fmtTokens(tip.d.tokens)}</b>
          </div>
          <div className="tip-row">
            <span>{tr('heatCost')}</span>
            <b>{fmtCost(tip.d.costUsd)}</b>
          </div>
          <div className="tip-row">
            <span>{tr('heatSessReq')}</span>
            <b>
              {tip.d.sessions} / {tip.d.requests}
            </b>
          </div>
        </Tip>
      )}
    </div>
  );
}
