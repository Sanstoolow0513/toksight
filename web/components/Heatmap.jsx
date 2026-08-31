'use client';

// GitHub-style activity heatmap: whole weeks as columns starting on Sunday,
// one row per weekday, ending today (partial last column). Tokens per local
// day drive a 5-step color scale; a tooltip carries cost/sessions/requests.

import { useState } from 'react';
import { fmtTokens, fmtCost } from '@/lib/format';

const LEVEL_COLORS = ['#1b2129', '#0e4429', '#196d32', '#2ea043', '#56d364'];
const CELL = 11;
const GAP = 3;
const PITCH = CELL + GAP;
const LABEL_X = 34;
const TOP = 18;

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

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

export default function Heatmap({ heatmap }) {
  const [tip, setTip] = useState(null);
  if (!heatmap?.days?.length) return <div className="muted">暂无数据</div>;

  const { days, maxTokens } = heatmap;
  const cols = [];
  for (let i = 0; i < days.length; i += 7) cols.push(days.slice(i, i + 7));

  const monthLabels = [];
  cols.forEach((col, ci) => {
    const firstOfMonth = col.find((d) => d.date.endsWith('-01'));
    if (firstOfMonth) {
      monthLabels.push({ x: LABEL_X + ci * PITCH, label: MONTHS[Number(firstOfMonth.date.slice(5, 7)) - 1] });
    }
  });

  const width = LABEL_X + cols.length * PITCH + 8;
  const height = TOP + 7 * PITCH + 8;

  return (
    <div className="hm" onMouseLeave={() => setTip(null)}>
      <div className="hm-scroll">
        <svg width={width} height={height} role="img" aria-label="每日活动热力图">
          {monthLabels.map((m) => (
            <text key={m.label + m.x} x={m.x} y={11} className="hm-text">
              {m.label}
            </text>
          ))}
          {WEEKDAYS.map((w, i) =>
            i % 2 === 1 ? (
              <text key={w} x={LABEL_X - 7} y={TOP + i * PITCH + CELL} textAnchor="end" className="hm-text">
                {w}
              </text>
            ) : null,
          )}
          {cols.map((col, ci) =>
            col.map((d, ri) => (
              <rect
                key={d.date}
                x={LABEL_X + ci * PITCH}
                y={TOP + ri * PITCH}
                width={CELL}
                height={CELL}
                rx={2.5}
                fill={LEVEL_COLORS[levelOf(d.tokens, maxTokens)]}
                stroke={d.tokens > 0 ? 'none' : 'rgba(255,255,255,0.05)'}
                onMouseEnter={(e) => setTip({ d, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setTip((t) => (t && t.d === d ? t : { d, x: e.clientX, y: e.clientY }))}
              />
            )),
          )}
        </svg>
      </div>
      <div className="hm-legend">
        <span>少</span>
        {LEVEL_COLORS.map((c) => (
          <i key={c} style={{ background: c }} />
        ))}
        <span>多</span>
      </div>
      {tip && (
        <div
          className="tip"
          style={{
            left: Math.min(tip.x + 12, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 230),
            top: tip.y + 14,
          }}
        >
          <div className="tip-title">
            {tip.d.date} · 周{WEEKDAYS[weekdayOf(tip.d.date)]}
          </div>
          <div className="tip-row">
            <span>Tokens</span>
            <b>{fmtTokens(tip.d.tokens)}</b>
          </div>
          <div className="tip-row">
            <span>费用</span>
            <b>{fmtCost(tip.d.costUsd)}</b>
          </div>
          <div className="tip-row">
            <span>会话 / 请求</span>
            <b>
              {tip.d.sessions} / {tip.d.requests}
            </b>
          </div>
        </div>
      )}
    </div>
  );
}
