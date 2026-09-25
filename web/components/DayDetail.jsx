'use client';

// One local day in full inside the opened heatmap card: KPIs, hours, agents
// with their model costs and the day's sessions. While another day loads
// (or failed to) the previous one stays on screen, dimmed.

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, TriangleAlert } from 'lucide-react';
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
    <section className="day-section">
      <header className="day-section-head">
        <h4>{title}</h4>
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

// Numbers, hours and agents form the main column; sessions sit beside it
// when the sheet is wide enough (year view) and below it otherwise.
function DayBody({ data, day, sortBy, onSort, locale, tx, agentLabel }) {
  const totals = data.totals ?? {};
  const hours = useMemo(() => hourlyBars(data.hourly), [data.hourly]);
  const sessions = useMemo(() => sessionRows(data.topSessions, SESSION_LIMIT), [data.topSessions]);

  if (!totals.requests) return <p className="day-empty">{tx('dayEmpty')}</p>;

  const sessionCount = totals.sessions ?? sessions.length;
  const sessionNote =
    sessionCount > sessions.length
      ? tx('sessionsTop', { shown: sessions.length, n: fmtInt(sessionCount) })
      : tx('sessionsAll', { n: fmtInt(sessionCount) });

  return (
    <>
      <div className="xday-main">
        <Kpis data={data} tx={tx} grid />
        <Section title={tx('secHourly')} note={hours.peak ? tx('hourlyPeak', { hour: hourText(hours.peak.hour) }) : null}>
          <HourlyChart bars={hours.bars} peak={hours.peak} label={tx('hourlyAria', { day: dayLabel(locale, day, true) })} tx={tx} />
          <PartsLegend tx={tx} />
        </Section>
        <Section title={tx('cardAgents')} note={tx(sortBy === 'cost' ? 'subAgentsCost' : 'subAgentsTokens', { period: dayLabel(locale, day) })}>
          <AgentTable clients={data.clients} models={data.models} pricing={data.pricing} sortBy={sortBy} onSort={onSort} agentLabel={agentLabel} tx={tx} />
        </Section>
      </div>
      {sessions.length ? (
        <div className="xday-side">
          <Section title={tx('secSessions')} note={sessionNote}>
            <ol className="session-list">
              {sessions.map((row) => (
                <SessionRow key={`${row.client}/${row.sessionId}`} row={row} agentLabel={agentLabel} locale={locale} tx={tx} />
              ))}
            </ol>
          </Section>
        </div>
      ) : null}
    </>
  );
}

function DaySkeleton() {
  return (
    <div className="day-skel" aria-busy="true">
      {[150, 168, 260].map((h) => (
        <div key={h} className="skel" style={{ height: h }} />
      ))}
    </div>
  );
}

export default function DayDetail({ day, report, nav, today, sortBy, onSort, onStep, locale, tx, agentLabel }) {
  const shown = report.data && report.day ? report : null;
  const stale = Boolean(shown) && (report.loading || shown.day !== day);
  const sub = [periodLabel(locale, { mode: 'year', year: Number(day.slice(0, 4)) }), weekdayLabel(locale, day), day === today ? tx('dayToday') : null];

  return (
    <section className="xday" aria-label={tx('dayPanel')}>
      <header className="xday-head">
        <div>
          <p className="eyebrow">{tx('dayPanel')}</p>
          <h3 className="xday-title" aria-live="polite">
            {dayLabel(locale, day)}
          </h3>
          <p className="xday-sub">{sub.filter(Boolean).join(' · ')}</p>
        </div>
        <div className="xday-nav">
          <button type="button" className="icon-btn" onClick={() => onStep(-1)} disabled={!nav.canPrev} aria-label={tx('dayPrev')} title={tx('dayPrev')}>
            <ChevronLeft {...icon} />
          </button>
          <button type="button" className="icon-btn" onClick={() => onStep(1)} disabled={!nav.canNext} aria-label={tx('dayNext')} title={tx('dayNext')}>
            <ChevronRight {...icon} />
          </button>
        </div>
      </header>
      {report.error ? (
        <div className="notice is-error day-error" role="alert">
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
        <div className={stale ? 'xday-content is-loading' : 'xday-content'}>
          <DayBody data={shown.data} day={shown.day} sortBy={sortBy} onSort={onSort} locale={locale} tx={tx} agentLabel={agentLabel} />
        </div>
      ) : report.error ? null : (
        <DaySkeleton />
      )}
    </section>
  );
}
