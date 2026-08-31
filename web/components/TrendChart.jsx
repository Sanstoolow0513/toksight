'use client';

// Daily token trend as a smooth stacked area chart (mountain style): each
// token class is drawn down to the baseline, top of stack first, so the
// visible bands are the differences between cumulative curves. Curvature is
// monotone-cubic (Fritsch–Carlson), which never overshoots the data, so
// stacked bands cannot cross between sample points. A segmented control
// switches the window (7 / 30 / 90 days) across the API-provided ranges.

import { useEffect, useRef, useState } from 'react';
import { fmtTokens, fmtCost } from '@/lib/format';

const CLASSES = [
  { key: 'input', label: '新输入', color: '#58a6ff' },
  { key: 'cacheRead', label: '缓存读取', color: '#3fb950' },
  { key: 'cacheWrite', label: '缓存写入', color: '#bc8cff' },
  { key: 'output', label: '输出', color: '#d29922' },
];

const PAD_L = 48;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 26;
const HEIGHT = 260;

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function monotonePath(pts) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    slope.push((pts[i + 1][1] - pts[i][1]) / Math.max(dx[i], 1e-9));
  }
  const t = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      t.push(0);
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]));
    }
  }
  t.push(slope[n - 2]);
  let path = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    path += `C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return path;
}

function niceStep(rough) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-9)));
  const norm = rough / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

const shortDate = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export default function TrendChart({ trends = {} }) {
  const options = [
    { days: 7, label: '近 7 天', rows: trends[7] },
    { days: 30, label: '近 30 天', rows: trends[30] },
    { days: 90, label: '近 90 天', rows: trends[90] },
  ].filter((o) => Array.isArray(o.rows) && o.rows.length > 0);
  const [days, setDays] = useState(null);
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  if (!options.length) return <div className="muted">暂无数据</div>;
  const active = options.find((o) => o.days === days) || options.find((o) => o.days === 30) || options[0];
  const rows = active.rows;
  const n = rows.length;

  const totals = rows.map((d) => CLASSES.reduce((s, c) => s + (d[c.key] || 0), 0));
  const maxVal = Math.max(...totals, 1);
  const step = niceStep(maxVal / 3.5);
  const top = Math.max(Math.ceil(maxVal / step) * step, step);
  const ticks = [];
  for (let v = step; v <= top + 1e-9; v += step) ticks.push(v);

  const innerW = Math.max(width - PAD_L - PAD_R, 10);
  const innerH = HEIGHT - PAD_T - PAD_B;
  const x = (i) => PAD_L + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => PAD_T + innerH * (1 - v / top);
  const baseY = y(0);

  // Cumulative sums per class, bottom of stack first; drawn top-most first.
  const cumulatives = [];
  let acc = rows.map(() => 0);
  for (const c of CLASSES) {
    acc = acc.map((v, i) => v + (rows[i][c.key] || 0));
    cumulatives.push(acc.slice());
  }

  const xTickIdx = [...new Set(Array.from({ length: Math.min(5, n) }, (_, k) => Math.round((k * (n - 1)) / Math.max(Math.min(5, n) - 1, 1))))];

  const windowTokens = totals.reduce((s, v) => s + v, 0);
  const windowCost = rows.reduce((s, d) => s + (d.costUsd || 0), 0);

  const pick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left - PAD_L) / innerW;
    const i = Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1))));
    setHover({ i, x: e.clientX, y: e.clientY });
  };

  return (
    <div>
      <div className="trend-head">
        <div className="seg" role="tablist" aria-label="时间范围">
          {options.map((o) => (
            <button key={o.days} role="tab" aria-selected={o.days === active.days} className={o.days === active.days ? 'on' : ''} onClick={() => setDays(o.days)}>
              {o.label}
            </button>
          ))}
        </div>
        <span className="trend-sum">
          合计 <b>{fmtTokens(windowTokens)}</b> tokens · {fmtCost(windowCost)}
        </span>
      </div>
      <div ref={ref} className="trend-chart" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label="每日 tokens 堆叠面积图">
            <defs>
              {CLASSES.map((c) => (
                <linearGradient key={c.key} id={`tg-${c.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.color} stopOpacity="0.8" />
                  <stop offset="100%" stopColor={c.color} stopOpacity="0.35" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD_L} x2={width - PAD_R} y1={y(v)} y2={y(v)} className="tc-grid" />
                <text x={PAD_L - 7} y={y(v) + 3.5} textAnchor="end" className="tc-text">
                  {fmtTokens(v)}
                </text>
              </g>
            ))}
            <line x1={PAD_L} x2={width - PAD_R} y1={baseY} y2={baseY} className="tc-axis" />
            {[...cumulatives].reverse().map((cum, rev) => {
              const k = cumulatives.length - 1 - rev;
              const c = CLASSES[k];
              const pts = cum.map((v, i) => [x(i), y(v)]);
              const d = `${monotonePath(pts)}L${x(n - 1)},${baseY} L${x(0)},${baseY} Z`;
              return <path key={c.key} d={d} fill={`url(#tg-${c.key})`} stroke={c.color} strokeWidth="1" strokeOpacity="0.9" />;
            })}
            {xTickIdx.map((i) => (
              <text key={i} x={x(i)} y={HEIGHT - 7} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="tc-text">
                {shortDate(rows[i].date)}
              </text>
            ))}
            {hover && (
              <line x1={x(hover.i)} x2={x(hover.i)} y1={PAD_T} y2={baseY} className="tc-guide" />
            )}
            {hover && (
              <circle cx={x(hover.i)} cy={y(totals[hover.i])} r="3" fill="#e6edf3" stroke="#0d1117" strokeWidth="1.5" />
            )}
            <rect
              x={PAD_L}
              y={PAD_T}
              width={innerW}
              height={innerH}
              fill="transparent"
              onMouseMove={pick}
              onMouseEnter={pick}
            />
          </svg>
        )}
        {hover && (
          <div
            className="tip"
            style={{
              left: Math.min(hover.x + 12, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 240),
              top: hover.y + 14,
            }}
          >
            <div className="tip-title">
              {rows[hover.i].date}
            </div>
            {CLASSES.slice().reverse().map((c) => (
              <div key={c.key} className="tip-row">
                <span>
                  <i className="tip-dot" style={{ background: c.color }} />
                  {c.label}
                </span>
                <b>{fmtTokens(rows[hover.i][c.key] || 0)}</b>
              </div>
            ))}
            <div className="tip-row tip-total">
              <span>合计</span>
              <b>{fmtTokens(totals[hover.i])}</b>
            </div>
            <div className="tip-row">
              <span>费用 / 会话</span>
              <b>
                {fmtCost(rows[hover.i].costUsd)} · {rows[hover.i].sessions}
              </b>
            </div>
          </div>
        )}
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
