'use client';

// Daily token trend as continuous lines anchored at each day's midpoint
// (design-spec §4): straight segments between days, no Bézier / monotone-
// cubic, no translucent SaaS gradients. Three cross-cutting views share the
// same engine:
//   - "mix"   → stack the four token classes (fresh input / cache read /
//               cache write / output) from the `trends` rows;
//   - "agent" → stack per-agent token volume from the `trendsByAgent` rows,
//               using the same rank palette order as the agent share card
//               (agents arrive sorted by volume; colors encode rank, not id);
//   - "model" → overlaid (not stacked) per-model curves from the
//               `trendsByModel` rows: the top three models by window volume
//               each get a rank-palette color, the rest fold into "other".
// Legend chips toggle series visibility; range segmented control switches
// 7 / 30 / 90 days. The 200ms fade plays only when the *user* changes
// range / mode / series — the first paint is static — so it reads as
// feedback instead of an entrance performance.

import { useEffect, useRef, useState } from 'react';
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
const MIN_HEIGHT = 240;

// Model mode: how many models get their own curve before the rest fold into
// the "other" bucket.
const MODEL_TOP = 3;
const OTHER_KEY = '__other__';

// Width AND height: the chart fills its flex:1 slot inside the dashboard
// grid cell (globals.css keeps a 300px floor in the static fallback).
function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// Filled silhouette under a polyline: straight segments between day
// midpoints, closed down to the baseline at both ends.
function lineArea(pts, baseY) {
  if (!pts.length) return '';
  let d = `M${pts[0][0]},${baseY}`;
  for (const [x, yv] of pts) d += `L${x},${yv}`;
  d += `L${pts[pts.length - 1][0]},${baseY}Z`;
  return d;
}

// Open polyline through the same midpoints: a series curve or the stack's
// top outline.
function linePath(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) d += `L${pts[i][0]},${pts[i][1]}`;
  return d;
}

function niceStep(rough) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-9)));
  const norm = rough / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

const shortDate = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export default function TrendChart({ selection, trends = {}, trendsByAgent = {}, trendsByModel = {}, agents = [], locale = 'zh-CN' }) {
  const options = selection ? [{ days: 'selection', labelKey: 'selectedRange', rows: selection.rows }] : [
    { days: 7, labelKey: 'trend7', rows: trends[7] },
    { days: 30, labelKey: 'trend30', rows: trends[30] },
    { days: 90, labelKey: 'trend90', rows: trends[90] },
  ].filter((o) => Array.isArray(o.rows) && o.rows.length > 0);
  const [days, setDays] = useState(null);
  const [mode, setMode] = useState('mix');
  const [hidden, setHidden] = useState({});
  const [ref, size] = useSize();
  const width = size.width;
  const height = Math.max(Math.round(size.height), MIN_HEIGHT);
  const [hover, setHover] = useState(null);
  const [userTouched, touch] = useUserInteraction();

  if (!options.length) return <div className="muted">{tr(locale, 'trendEmpty')}</div>;
  const active = options.find((o) => o.days === days) || options.find((o) => o.days === 30) || options[0];
  const rows = active.rows;
  const n = rows.length;
  const agentRows = selection ? selection.byAgent : trendsByAgent?.[active.days];
  const agentDataOk = Array.isArray(agentRows) && agentRows.length === n;
  const modelRows = selection ? selection.byModel : trendsByModel?.[active.days];
  const modelDataOk = Array.isArray(modelRows) && modelRows.length === n;
  const agentMode = mode === 'agent' && agentDataOk;
  const modelMode = mode === 'model' && modelDataOk;

  // Model series: rank models by window volume, keep the top three as their
  // own curves and fold the rest into a single "other" curve.
  let series;
  if (modelMode) {
    const totals = new Map();
    for (const r of modelRows) {
      for (const [k, v] of Object.entries(r.models || {})) totals.set(k, (totals.get(k) || 0) + v);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const topModels = ranked.slice(0, MODEL_TOP).filter(([, v]) => v > 0);
    const restTotal = ranked.slice(MODEL_TOP).reduce((s, [, v]) => s + v, 0);
    series = topModels.map(([key], i) => ({ key, label: key, color: colorAt(i) }));
    if (restTotal > 0) series.push({ key: OTHER_KEY, label: tr(locale, 'trendOther'), color: colorAt(MODEL_TOP) });
  } else if (agentMode) {
    series = agents.map((a, i) => ({ key: a.id, label: a.label || a.id, color: colorAt(i) }));
  } else {
    series = CLASS_KEYS.map((key) => ({ key, label: tr(locale, CLASS_LABEL_KEYS[key]), color: CLASS_COLORS[key] }));
  }
  const topModelKeys = new Set(series.filter((s) => s.key !== OTHER_KEY).map((s) => s.key));

  const toggle = (key) => {
    const next = { ...hidden, [key]: !hidden[key] };
    const visibleCount = series.filter((s) => !next[s.key]).length;
    if (visibleCount === 0) return;
    touch();
    setHidden(next);
  };

  const visible = series.filter((s) => !hidden[s.key]);
  const valueOf = (i, s) => {
    if (modelMode) {
      const models = modelRows[i].models || {};
      if (s.key === OTHER_KEY) {
        let v = 0;
        for (const [k, val] of Object.entries(models)) if (!topModelKeys.has(k)) v += val;
        return v;
      }
      return models[s.key] || 0;
    }
    return agentMode ? agentRows[i].clients?.[s.key] || 0 : rows[i][s.key] || 0;
  };

  const dayTotals = rows.map((d) => d.tokens || 0);
  // Stacked modes scale to the daily total; overlaid model curves scale to
  // the largest single-series day so the lines use the full height.
  const maxVal = modelMode
    ? Math.max(...rows.map((_, i) => Math.max(0, ...visible.map((s) => valueOf(i, s)))), 1)
    : Math.max(...dayTotals, 1);
  const step = niceStep(maxVal / 3.5);
  const top = Math.max(Math.ceil(maxVal / step) * step, step);
  const ticks = [];
  for (let v = step; v <= top + 1e-9; v += step) ticks.push(v);

  const innerW = Math.max(width - PAD_L - PAD_R, 10);
  const innerH = height - PAD_T - PAD_B;
  const slotW = innerW / n;
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
  const bandKey = `${animated ? 1 : 0}-${modelMode ? 'model' : agentMode ? 'agent' : 'mix'}-${active.days}-${visible.map((s) => s.key).join('.')}`;

  return (
    <div className="trend">
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
            <button type="button" role="tab" aria-selected={!agentMode && !modelMode} className={!agentMode && !modelMode ? 'on' : ''} onClick={() => { touch(); setMode('mix'); }}>
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
            <button
              type="button"
              role="tab"
              aria-selected={modelMode}
              className={modelMode ? 'on' : ''}
              onClick={() => { touch(); setMode('model'); }}
              disabled={!modelDataOk}
            >
              {tr(locale, 'modeModel')}
            </button>
          </div>
        </div>
        <span className="trend-sum">
          {tr(locale, 'trendTotal')} <b>{fmtTokens(windowTokens)}</b> {tr(locale, 'trendSum', { cost: fmtCost(windowCost) })}
        </span>
      </div>
      <div ref={ref} className="trend-chart" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={tr(locale, 'trendAria')}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD_L} x2={width - PAD_R} y1={y(v)} y2={y(v)} className="tc-grid" />
                <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" className="tc-text">
                  {fmtTokens(v)}
                </text>
              </g>
            ))}
            <line x1={PAD_L} x2={width - PAD_R} y1={baseY} y2={baseY} className="tc-axis" />
            <g key={bandKey} className={animated ? 'trend-fade' : undefined}>
              {modelMode
                ? visible.map((s) => (
                    <path
                      key={s.key}
                      d={linePath(rows.map((_, i) => [xMid(i), y(valueOf(i, s))]))}
                      className="trend-line"
                      style={{ stroke: s.color }}
                    />
                  ))
                : [...cumulatives].reverse().map((cum, rev) => {
                    const k = cumulatives.length - 1 - rev;
                    const s = visible[k];
                    const pts = cum.map((v, i) => [xMid(i), y(v)]);
                    return (
                      <path
                        key={s.key}
                        d={lineArea(pts, baseY)}
                        className="trend-band"
                        style={{ fill: s.color }}
                      />
                    );
                  })}
              {!modelMode && <path d={linePath(rows.map((_, i) => [xMid(i), y(visibleTop(i))]))} className="trend-top" />}
            </g>
            {xTickIdx.map((i) => (
              <text key={i} x={xMid(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="tc-text">
                {shortDate(rows[i].date)}
              </text>
            ))}
            {hover && <line x1={xMid(hover.i)} x2={xMid(hover.i)} y1={PAD_T} y2={baseY} className="tc-guide" />}
            {hover && modelMode
              ? visible.map((s) => (
                  <circle
                    key={s.key}
                    cx={xMid(hover.i)}
                    cy={y(valueOf(hover.i, s))}
                    r="3"
                    className="trend-mark"
                    style={{ fill: s.color }}
                  />
                ))
              : hover && (
                  <circle
                    cx={xMid(hover.i)}
                    cy={y(visibleTop(hover.i))}
                    r="3"
                    className="trend-mark"
                  />
                )}
            <rect
              x={PAD_L}
              y={PAD_T}
              width={innerW}
              height={innerH}
              fill="transparent"
              tabIndex={0}
              onMouseMove={pick}
              onMouseEnter={pick}
              onFocus={(e) => {
                // Keyboard users get the latest day's readout, anchored at
                // that day's slot instead of a pointer position.
                const rect = e.currentTarget.getBoundingClientRect();
                const i = n - 1;
                setHover({ i, x: rect.left + ((i + 0.5) / n) * rect.width, y: rect.top });
              }}
              onBlur={() => setHover(null)}
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
                {tr(locale, 'trendCostSessValue', {
                  cost: fmtCost((agentMode ? agentRows[hover.i].costUsd : modelMode ? modelRows[hover.i].costUsd : rows[hover.i].costUsd) || 0),
                  sessions: agentMode ? agentRows[hover.i].sessions : modelMode ? modelRows[hover.i].sessions : rows[hover.i].sessions,
                })}
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
