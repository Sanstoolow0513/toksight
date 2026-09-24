'use client';

// Day card: a non-modal card beside the report column that shows one local
// day in detail (KPIs, hours, agents with model costs, sessions) while the report
// stays usable. `.day-dock` is the flex slot that opens up next to the
// column; the card inside sticks to the viewport. It stays mounted while
// closed so it can animate out with the last day on screen; `inert` takes
// it out of focus and a11y then.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, TriangleAlert, X } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import { coded } from '@/components/Coded';
import Kpis from '@/components/Kpis';
import AgentTable from '@/components/AgentTable';
import { CostValue, PartsLegend, agentStyle } from '@/components/Marks';
import { hourlyBars, sessionRows } from '@/lib/report';
import { fmtClockRange, fmtCost, fmtInt, fmtTokens } from '@/lib/format';
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

function HourlyChart({ bars, peak, label, tx }) {
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
            <div className="hour-bar" style={{ height: bar.value > 0 ? `max(3px, ${bar.height * 100}%)` : 0 }}>
              {bar.parts.map((part, i) => (part > 0 ? <i key={i} className={`part-${i}`} style={{ flexGrow: part }} /> : null))}
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

function SessionRow({ row, agentLabel, locale, tx }) {
  const meta = [
    agentLabel(row.client),
    fmtClockRange(row.startedAt, row.endedAt),
    row.activeMs > 0 ? tx('sessionActive', { time: durationLabel(locale, row.activeMs) }) : null,
    tx('rowRequests', { n: fmtInt(row.requests) }),
  ].filter(Boolean);
  const detail = [row.directory, (row.models ?? []).join(', ')].filter(Boolean).join(' · ');
  const name = row.name ?? tx('sessionUntitled');
  return (
    <li className="session-row" style={agentStyle(row.client)}>
      <div className="session-line">
        <span className="session-name" title={row.name ?? row.sessionId}>
          {name}
        </span>
        <span className="cell-value">{fmtTokens(row.totalTokens)}</span>
        <CostValue row={row} tx={tx} />
      </div>
      <div className="session-meta">{meta.join(' · ')}</div>
      {detail ? (
        <div className="session-detail" title={detail}>
          {detail}
        </div>
      ) : null}
    </li>
  );
}

function DayBody({ data, day, sortBy, onSort, locale, tx, agentLabel }) {
  const totals = data.totals ?? {};
  const hours = useMemo(() => hourlyBars(data.hourly), [data.hourly]);
  const sessions = useMemo(() => sessionRows(data.topSessions, SESSION_LIMIT), [data.topSessions]);

  if (!totals.requests) return <p className="panel-empty">{tx('dayEmpty')}</p>;

  const sessionCount = totals.sessions ?? sessions.length;
  const sessionNote =
    sessionCount > sessions.length
      ? tx('sessionsTop', { shown: sessions.length, n: fmtInt(sessionCount) })
      : tx('sessionsAll', { n: fmtInt(sessionCount) });

  return (
    <>
      <Kpis data={data} tx={tx} grid />
      <Section title={tx('secHourly')} note={hours.peak ? tx('hourlyPeak', { hour: hourText(hours.peak.hour) }) : null}>
        <HourlyChart bars={hours.bars} peak={hours.peak} label={tx('hourlyAria', { day: dayLabel(locale, day, true) })} tx={tx} />
        <PartsLegend tx={tx} />
      </Section>
      <Section title={tx('cardAgents')} note={tx(sortBy === 'cost' ? 'subAgentsCost' : 'subAgentsTokens', { period: dayLabel(locale, day) })}>
        <AgentTable clients={data.clients} models={data.models} pricing={data.pricing} sortBy={sortBy} onSort={onSort} agentLabel={agentLabel} tx={tx} />
      </Section>
      {sessions.length ? (
        <Section title={tx('secSessions')} note={sessionNote}>
          <ol className="session-list">
            {sessions.map((row) => (
              <SessionRow key={`${row.client}/${row.sessionId}`} row={row} agentLabel={agentLabel} locale={locale} tx={tx} />
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
      {[168, 150, 280].map((h) => (
        <div key={h} className="skel" style={{ height: h }} />
      ))}
    </div>
  );
}

export default function DayPanel({ open, day, report, nav, today, sortBy, onSort, onStep, onClose, locale, tx, agentLabel }) {
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
              <p className="panel-sub">{sub.filter(Boolean).join(' · ')}</p>
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
                  <DayBody data={shown.data} day={shown.day} sortBy={sortBy} onSort={onSort} locale={locale} tx={tx} agentLabel={agentLabel} />
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
