'use client';

// Day card: a non-modal card beside the report column that shows one local
// day in detail (KPIs, hours, agents, models, sessions) while the report
// stays usable. `.day-dock` is the flex slot that opens up next to the
// column; the card inside sticks to the viewport. It stays mounted while
// closed so it can animate out with the last day on screen; `inert` takes
// it out of focus and a11y then.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, TriangleAlert, X } from 'lucide-react';
import Segmented from '@/components/Segmented';
import Tooltip from '@/components/Tooltip';
import { coded } from '@/components/Coded';
import { PartsLegend, RankRow, ShareBar, costText } from '@/components/RankList';
import { agentRows, hourlyBars, modelRows, sessionRows } from '@/lib/report';
import { fmtClockRange, fmtCost, fmtInt, fmtMetric, fmtPct, fmtTokens } from '@/lib/format';
import { dayLabel, durationLabel, periodLabel, weekdayLabel } from '@/lib/i18n';

const icon = { size: 15, strokeWidth: 2, 'aria-hidden': true };
const SESSION_LIMIT = 10;
const AXIS_HOURS = [0, 6, 12, 18, 24];
const hourText = (h) => `${String(h).padStart(2, '0')}:00`;

function Section({ title, note, children }) {
  return (
    <section className="panel-section">
      <header className="panel-section-head">
        <h3>{title}</h3>
        {note ? <span>{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="panel-stat">
      <dt>{label}</dt>
      <dd>
        <span className="stat-value">{value}</span>
        <span className="stat-sub">{sub}</span>
      </dd>
    </div>
  );
}

function DayKpis({ data, tx }) {
  const totals = data.totals ?? {};
  const unpriced = data.pricing?.unpricedModels ?? [];
  return (
    <dl className="panel-kpis">
      <Stat
        label={tx('kpiTokens')}
        value={fmtTokens(totals.totalTokens)}
        sub={tx('kpiTokensSub', {
          input: fmtTokens((totals.inputTokens ?? 0) + (totals.cacheReadTokens ?? 0) + (totals.cacheWriteTokens ?? 0)),
          output: fmtTokens(totals.outputTokens),
        })}
      />
      <Stat
        label={tx('kpiCost')}
        value={fmtCost(totals.costUsd)}
        sub={unpriced.length ? tx('kpiCostUnpriced', { n: unpriced.length }) : tx('kpiCostAll')}
      />
      <Stat label={tx('kpiCache')} value={fmtPct(data.cacheHitRate)} sub={tx('kpiCacheSub', { tokens: fmtTokens(totals.cacheReadTokens) })} />
      <Stat label={tx('kpiRequests')} value={fmtInt(totals.requests)} sub={tx('kpiRequestsSub', { n: fmtInt(totals.sessions) })} />
    </dl>
  );
}

function HourlyChart({ bars, peak, metric, label, tx }) {
  const [tip, setTip] = useState(null);
  const onMove = (e) => {
    const hour = e.target.closest?.('[data-hour]')?.dataset.hour;
    if (hour == null) return setTip(null);
    setTip({ hour: Number(hour), x: e.clientX, y: e.clientY });
  };
  const row = tip ? bars[tip.hour].row : null;
  return (
    <div className="hourly" role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
      <div className="hourly-bars">
        {bars.map((bar) => (
          <div key={bar.hour} data-hour={bar.hour} className={bar.hour === peak?.hour ? 'hour-col is-peak' : 'hour-col'}>
            <div className={metric === 'cost' ? 'hour-bar is-cost' : 'hour-bar'} style={{ height: bar.value > 0 ? `max(3px, ${bar.height * 100}%)` : 0 }}>
              {metric === 'tokens'
                ? bar.parts.map((part, i) => (part > 0 ? <i key={i} className={`part-${i}`} style={{ flexGrow: part }} /> : null))
                : null}
            </div>
          </div>
        ))}
      </div>
      <div className="hourly-axis" aria-hidden="true">
        {AXIS_HOURS.map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {hourText(h)}
          </span>
        ))}
      </div>
      {tip ? (
        <Tooltip x={tip.x} y={tip.y}>
          <div className="tip-title">
            {hourText(tip.hour)} – {hourText(tip.hour + 1)}
          </div>
          {row?.requests ? (
            <>
              <div className="tip-row"><span>{tx('tipTokens')}</span><b>{fmtTokens(row.tokens)}</b></div>
              <div className="tip-row"><span>{tx('tipCost')}</span><b>{fmtCost(row.costUsd)}</b></div>
              <div className="tip-row"><span>{tx('tipRequests')}</span><b>{fmtInt(row.requests)} / {fmtInt(row.sessions)}</b></div>
            </>
          ) : (
            <div className="tip-muted">{tx('tipIdle')}</div>
          )}
        </Tooltip>
      ) : null}
    </div>
  );
}

function SessionRow({ row, metric, agentLabel, locale, tx }) {
  const meta = [
    agentLabel(row.client),
    fmtClockRange(row.startedAt, row.endedAt),
    row.activeMs > 0 ? tx('sessionActive', { time: durationLabel(locale, row.activeMs) }) : null,
    metric === 'cost' ? `${fmtTokens(row.totalTokens)} tokens` : costText(row, tx),
    tx('rowRequests', { n: fmtInt(row.requests) }),
  ].filter(Boolean);
  const detail = [row.directory, (row.models ?? []).join(', ')].filter(Boolean).join(' · ');
  const name = row.name ?? tx('sessionUntitled');
  return (
    <li className="rank-row">
      <div className="rank-line">
        <span className="rank-name" title={row.name ?? row.sessionId}>
          {name}
        </span>
        <span className="rank-value">{metric === 'cost' && row.pricing === 'none' ? '—' : fmtMetric(row.value, metric)}</span>
        <span className="rank-share">{fmtPct(row.share)}</span>
      </div>
      <ShareBar share={row.share} parts={row.parts} metric={metric} />
      <div className="rank-meta">{meta.join(' · ')}</div>
      {detail ? (
        <div className="session-detail" title={detail}>
          {detail}
        </div>
      ) : null}
    </li>
  );
}

function DayBody({ data, day, metric, locale, tx, agentLabel }) {
  const totals = data.totals ?? {};
  const hours = useMemo(() => hourlyBars(data.hourly, metric), [data.hourly, metric]);
  const agents = useMemo(() => agentRows(data.clients, metric), [data.clients, metric]);
  const models = useMemo(() => modelRows(data.models, metric), [data.models, metric]);
  const sessions = useMemo(() => sessionRows(data.topSessions, totals, metric, SESSION_LIMIT), [data.topSessions, totals, metric]);

  if (!totals.requests) return <p className="panel-empty">{tx('dayEmpty')}</p>;

  const sessionCount = totals.sessions ?? sessions.length;
  const sessionNote =
    sessionCount > sessions.length
      ? tx('sessionsTop', { shown: sessions.length, n: fmtInt(sessionCount) })
      : tx('sessionsAll', { n: fmtInt(sessionCount) });

  return (
    <>
      <DayKpis data={data} tx={tx} />
      <Section title={tx('secHourly')} note={hours.peak ? tx('hourlyPeak', { hour: hourText(hours.peak.hour) }) : null}>
        <HourlyChart bars={hours.bars} peak={hours.peak} metric={metric} label={tx('hourlyAria', { day: dayLabel(locale, day, true) })} tx={tx} />
        {metric === 'tokens' ? <PartsLegend tx={tx} /> : null}
      </Section>
      <Section title={tx('cardAgents')} note={tx(metric === 'cost' ? 'subRankCost' : 'subRankTokens', { period: dayLabel(locale, day) })}>
        <ol className="rank-list">
          {agents.map((row) => (
            <RankRow key={row.id} name={agentLabel(row.id)} row={row} metric={metric} tx={tx} />
          ))}
        </ol>
      </Section>
      <Section title={tx('cardModels')} note={tx(metric === 'cost' ? 'subRankCost' : 'subRankTokens', { period: dayLabel(locale, day) })}>
        <ol className="rank-list">
          {models.rows.map((row, i) => (
            <RankRow
              key={row.id}
              rank={i + 1}
              name={row.model}
              mono
              lead={tx('rowAgent', { agent: agentLabel(row.client) })}
              row={row}
              metric={metric}
              tx={tx}
            />
          ))}
          {models.others ? (
            <RankRow rank="…" name={tx('others', { n: models.others.count })} row={models.others} metric={metric} tx={tx} muted />
          ) : null}
        </ol>
      </Section>
      {sessions.length ? (
        <Section title={tx('secSessions')} note={sessionNote}>
          <ol className="rank-list session-list">
            {sessions.map((row) => (
              <SessionRow key={`${row.client}/${row.sessionId}`} row={row} metric={metric} agentLabel={agentLabel} locale={locale} tx={tx} />
            ))}
          </ol>
        </Section>
      ) : null}
    </>
  );
}

function PanelSkeleton() {
  return (
    <div className="panel-skel" aria-busy="true">
      {[168, 150, 180, 220].map((h) => (
        <div key={h} className="skel" style={{ height: h }} />
      ))}
    </div>
  );
}

export default function DayPanel({ open, day, report, nav, today, metric, onMetric, onStep, onClose, locale, tx, agentLabel }) {
  const ref = useRef(null);
  const opener = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus moves into the panel only when it opens, not when another day is
  // picked while it is already open; closing hands focus back.
  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const back = opener.current;
      if (back?.isConnected && ref.current?.contains(document.activeElement)) back.focus({ preventScroll: true });
    };
  }, [open]);

  // While another day loads (or failed to), the previous day stays dimmed.
  const shown = report.data && report.day ? report : null;
  const stale = Boolean(shown) && (report.loading || shown.day !== day);
  const sub = day
    ? [periodLabel(locale, { mode: 'year', year: Number(day.slice(0, 4)) }), weekdayLabel(locale, day), day === today ? tx('dayToday') : null]
    : [];

  return (
    <div className={open ? 'day-dock is-open' : 'day-dock'}>
      <aside ref={ref} className="day-panel" aria-label={tx('dayPanel')} tabIndex={-1} inert={!open}>
        {day ? (
          <>
            <header className="panel-head">
              <div className="panel-top">
                <p className="eyebrow">{tx('dayPanel')}</p>
                <div className="panel-actions">
                  <button type="button" className="icon-btn" onClick={() => onStep(-1)} disabled={!nav.canPrev} aria-label={tx('dayPrev')} title={tx('dayPrev')}>
                    <ChevronLeft {...icon} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => onStep(1)} disabled={!nav.canNext} aria-label={tx('dayNext')} title={tx('dayNext')}>
                    <ChevronRight {...icon} />
                  </button>
                  <button type="button" className="icon-btn" onClick={onClose} aria-label={tx('dayClose')} title={tx('dayClose')}>
                    <X {...icon} />
                  </button>
                </div>
              </div>
              <h2 className="panel-title" aria-live="polite">
                {dayLabel(locale, day)}
              </h2>
              <div className="panel-meta">
                <p className="panel-sub">{sub.filter(Boolean).join(' · ')}</p>
                <Segmented
                  compact
                  label={tx('metricGroup')}
                  value={metric}
                  onChange={onMetric}
                  options={[{ value: 'tokens', label: tx('metricTokens') }, { value: 'cost', label: tx('metricCost') }]}
                />
              </div>
            </header>
            <div className="panel-body">
              {report.error ? (
                <div className="notice is-error panel-error" role="alert">
                  <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
                  <div>
                    <p>{coded(tx('errorBody', { error: report.error }))}</p>
                    <button type="button" className="btn-secondary" onClick={() => void report.reload()}>
                      <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
                      {tx('retry')}
                    </button>
                  </div>
                </div>
              ) : null}
              {shown ? (
                <div className={stale ? 'panel-content is-loading' : 'panel-content'}>
                  <DayBody data={shown.data} day={shown.day} metric={metric} locale={locale} tx={tx} agentLabel={agentLabel} />
                </div>
              ) : report.error ? null : (
                <PanelSkeleton />
              )}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}
