'use client';

// Daily token trend as a step-after stacked worksheet (Brutalism, spec v6):
// each day is a rectangular band, not a smooth mountain. Series are drawn
// down to the baseline, top of stack first, so the visible bands are the
// differences between cumulative steps. No Bézier / monotone-cubic, no
// translucent fill — those read as SaaS gradients.
//
// Two cross-cutting views share the same engine:
//   - "mix"   → stack the four token classes (fresh input / cache read /
//               cache write / output) from the `trends` rows;
//   - "agent" → stack per-agent token volume from the `trendsByAgent` rows,
//               using the same rank palette order as the agent share card
//               (agents arrive sorted by volume; colors encode rank, not id).
// Legend chips toggle series visibility; range segmented control switches
// 7 / 30 / 90 days. The wipe reveal plays only when the *user* changes
// range / mode / series — the first paint is static — so it reads as
// feedback instead of an entrance performance.

import { useEffect, useId, useRef, useState } from 'react';
import { fmtTokens, fmtCost } from '@/lib/format';
import { colorAt } from '@/lib/palette';
import { t as tr } from '@/lib/i18n';
import Tip from '@/components/Tip';

function useUserInteraction() {
  const ref = useRef(false);
  const touch = () => {
    ref.current = true;
  };
  return [ref, touch];
}

const CLASS_KEYS = ['input', 'cacheRead', 'cacheWrite', 'output'];
const CLASS_LABEL_KEYS = {
  input: 'trendInput',
  cacheRead: 'trendCacheRead',
  cacheWrite: 'trendCacheWrite',
  output: 'trendOutput',
};
const CLASS_COLORS = {
  input: 'var(--color-chart-input)',
  cacheRead: 'var(--color-chart-cache-read)',
  cacheWrite: 'var(--color-chart-cache-write)',
  output: 'var(--color-chart-output)',
};

const PAD_L = 48;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 24;
const HEIGHT = 300;

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

// Step-after silhouette: hold each day's y across its slot, then jump.
function stepArea(pts, slotW, baseY) {
  const n = pts.length;
  if (n === 0) return '';
  const x0 = pts[0][0];
  const xN = pts[n - 1][0] + slotW;
  let d = `M${x0},${baseY}L${x0},${pts[0][1]}`;
  for (let i = 0; i < n; i++) {
    const xRight = pts[i][0] + slotW;
    d += `L${xRight},${pts[i][1]}`;
    if (i < n - 1) d += `L${xRight},${pts[i + 1][1]}`;
  }
  d += `L${xN},${baseY}Z`;
  return d;
}

function niceStep(rough) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-9)));
  const norm = rough / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

const shortDate = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export default function TrendChart({ trends = {}, trendsByAgent = {}, agents = [], locale = 'zh-CN' }) {
  const options = [
    { days: 7, labelKey: 'trend7', rows: trends[7] },
    { days: 30, labelKey: 'trend30', rows: trends[30] },
    { days: 90, labelKey: 'trend90', rows: trends[90] },
  ].filter((o) => Array.isArray(o.rows) && o.rows.length > 0);
  const [days, setDays] = useState(null);
  const [mode, setMode] = useState('mix');
  const [hidden, setHidden] = useState({});
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const [userTouched, touch] = useUserInteraction();
  const clipId = `twipe${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  if (!options.length) return <div className="muted">{tr(locale, 'trendEmpty')}</div>;
  const active = options.find((o) => o.days === days) || options.find((o) => o.days === 30) || options[0];
  const rows = active.rows;
  const n = rows.length;
  const agentRows = trendsByAgent?.[active.days];
  const agentDataOk = Array.isArray(agentRows) && agentRows.length === n;
  const agentMode = mode === 'agent' && agentDataOk;

  const series = agentMode
    ? agents.map((a, i) => ({ key: a.id, label: a.label || a.id, color: colorAt(i) }))
    : CLASS_KEYS.map((key) => ({ key, label: tr(locale, CLASS_LABEL_KEYS[key]), color: CLASS_COLORS[key] }));

  const toggle = (key) => {
    const next = { ...hidden, [key]: !hidden[key] };
    const visibleCount = series.filter((s) => !next[s.key]).length;
    if (visibleCount === 0) return;
    touch();
    setHidden(next);
  };

  const visible = series.filter((s) => !hidden[s.key]);
  const valueOf = (i, s) => (agentMode ? agentRows[i].clients?.[s.key] || 0 : rows[i][s.key] || 0);

  const dayTotals = rows.map((d) => d.tokens || 0);
  const maxVal = Math.max(...dayTotals, 1);
  const step = niceStep(maxVal / 3.5);
  const top = Math.max(Math.ceil(maxVal / step) * step, step);
  const ticks = [];
  for (let v = step; v <= top + 1e-9; v += step) ticks.push(v);

  const innerW = Math.max(width - PAD_L - PAD_R, 10);
  const innerH = HEIGHT - PAD_T - PAD_B;
  const slotW = innerW / n;
  const xLeft = (i) => PAD_L + i * slotW;
  const xMid = (i) => PAD_L + (i + 0.5) * slotW;
  const y = (v) => PAD_T + innerH * (1 - v / top);
  const baseY = y(0);

  const cumulatives = [];
  let acc = rows.map(() => 0);
  for (const s of visible) {
    acc = acc.map((v, i) => v + valueOf(i, s));
    cumulatives.push(acc.slice());
  }
  const visibleTop = (i) => (cumulatives.length ? cumulatives[cumulatives.length - 1][i] : dayTotals[i]);

  const xTickIdx = [...new Set(Array.from({ length: Math.min(5, n) }, (_, k) => Math.round((k * (n - 1)) / Math.max(Math.min(5, n) - 1, 1))))];

  const windowTokens = dayTotals.reduce((s, v) => s + v, 0);
  const windowCost = rows.reduce((s, d) => s + (d.costUsd || 0), 0);

  const pick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - rect.left) / rect.width) * n)));
    setHover({ i, x: e.clientX, y: e.clientY });
  };

  const animated = userTouched.current;
  const bandKey = `${animated ? 1 : 0}-${agentMode ? 'agent' : 'mix'}-${active.days}-${visible.map((s) => s.key).join('.')}`;

  return (
    <div>
      <div className="trend-head">
        <div className="trend-controls">
          <div className="seg" role="tablist" aria-label={tr(locale, 'trendRange')}>
            {options.map((o) => (
              <button key={o.days} type="button" role="tab" aria-selected={o.days === active.days} className={o.days === active.days ? 'on' : ''} onClick={() => { touch(); setDays(o.days); }}>
                {tr(locale, o.labelKey)}
              </button>
            ))}
          </div>
          <div className="seg" role="tablist" aria-label={tr(locale, 'trendMode')}>
            <button type="button" role="tab" aria-selected={!agentMode} className={!agentMode ? 'on' : ''} onClick={() => { touch(); setMode('mix'); }}>
              {tr(locale, 'modeMix')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={agentMode}
              className={agentMode ? 'on' : ''}
              onClick={() => { touch(); setMode('agent'); }}
              disabled={!agentDataOk}
            >
              {tr(locale, 'modeAgent')}
            </button>
          </div>
        </div>
        <span className="trend-sum">
          {tr(locale, 'trendTotal')} <b>{fmtTokens(windowTokens)}</b> tokens · {fmtCost(windowCost)}
        </span>
      </div>
      <div ref={ref} className="trend-chart" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={tr(locale, 'trendAria')}>
            <defs>
              <clipPath id={clipId}>
                <rect key={bandKey} x={PAD_L - 2} y={PAD_T - 2} width={innerW + 4} height={innerH + 4} className={animated ? 'trend-wipe' : undefined} />
              </clipPath>
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD_L} x2={width - PAD_R} y1={y(v)} y2={y(v)} className="tc-grid" />
                <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" className="tc-text">
                  {fmtTokens(v)}
                </text>
              </g>
            ))}
            <line x1={PAD_L} x2={width - PAD_R} y1={baseY} y2={baseY} className="tc-axis" />
            <g key={bandKey} clipPath={`url(#${clipId})`}>
              {[...cumulatives].reverse().map((cum, rev) => {
                const k = cumulatives.length - 1 - rev;
                const s = visible[k];
                const pts = cum.map((v, i) => [xLeft(i), y(v)]);
                return (
                  <path
                    key={s.key}
                    d={stepArea(pts, slotW, baseY)}
                    className="trend-band"
                    style={{ fill: s.color }}
                    shapeRendering="crispEdges"
                  />
                );
              })}
            </g>
            {xTickIdx.map((i) => (
              <text key={i} x={xMid(i)} y={HEIGHT - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="tc-text">
                {shortDate(rows[i].date)}
              </text>
            ))}
            {hover && <line x1={xMid(hover.i)} x2={xMid(hover.i)} y1={PAD_T} y2={baseY} className="tc-guide" />}
            {hover && (
              <rect
                x={xMid(hover.i) - 3}
                y={y(visibleTop(hover.i)) - 3}
                width="6"
                height="6"
                className="trend-mark"
              />
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
          <Tip x={hover.x} y={hover.y} width={240}>
            <div className="tip-title">{rows[hover.i].date}</div>
            {[...visible].reverse().map((s) => (
              <div key={s.key} className="tip-row">
                <span>
                  <i className="tip-swatch" style={{ background: s.color }} />
                  {s.label}
                </span>
                <b>{fmtTokens(valueOf(hover.i, s))}</b>
              </div>
            ))}
            <div className="tip-row tip-total">
              <span>{tr(locale, 'trendTotal')}</span>
              <b>{fmtTokens(dayTotals[hover.i])}</b>
            </div>
            <div className="tip-row">
              <span>{tr(locale, 'trendCostSess')}</span>
              <b>
                {fmtCost((agentMode ? agentRows[hover.i].costUsd : rows[hover.i].costUsd) || 0)} ·{' '}
                {agentMode ? agentRows[hover.i].sessions : rows[hover.i].sessions}
              </b>
            </div>
          </Tip>
        )}
      </div>
      <div className="legend-row">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`legend-chip${hidden[s.key] ? ' off' : ''}`}
            onClick={() => toggle(s.key)}
            aria-pressed={!hidden[s.key]}
          >
            <i style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
