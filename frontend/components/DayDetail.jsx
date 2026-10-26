'use client';

// Flat day details shared by Today and the calendar. Rendered sections remain
// visible in the normal page flow and in exported images.

import { useCallback, useMemo, useState } from 'react';
import { ArrowUp, ChevronLeft, ChevronRight, RefreshCw, TriangleAlert } from 'lucide-react';
import ActivityChart from '@/components/ActivityChart';
import TokenBreakdown from '@/components/TokenBreakdown';
import { coded } from '@/components/Coded';
import AgentTable from '@/components/AgentTable';
import ModelTable from '@/components/ModelTable';
import Kpis from '@/components/Kpis';
import { CostValue, agentStyle } from '@/components/Marks';
import { hasModelComparison, sessionRows } from '@/lib/report';
import { fmtClockRange, fmtCost, fmtInt, fmtTokens } from '@/lib/format';
import { dayLabel, durationLabel, periodLabel, weekdayLabel } from '@/lib/i18n';

const icon = { size: 15, strokeWidth: 2, 'aria-hidden': true };
const SESSION_LIMIT = 10;
function SessionRow({ row, agentLabel, locale, tx, timezone }) {
  const meta = [
    agentLabel(row.client),
    fmtClockRange(row.startedAt, row.endedAt, timezone),
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

// The same day anatomy is used in the overview and the calendar detail.
export function DayBody({ data, day, sortBy, onSort, locale, tx, agentLabel, open, onToggle, overview = false }) {
  const [expanded, setExpanded] = useState(false);
  const sessions = useMemo(() => sessionRows(data.topSessions, SESSION_LIMIT), [data.topSessions]);
  const visible = expanded ? sessions : sessions.slice(0, 5);
  return <div className={'day-sections' + (overview ? ' is-overview' : '')}>
    <div className="analysis-grid"><ActivityChart data={data} tx={tx} /><TokenBreakdown data={data} tx={tx} /></div>
    {!data.totals?.requests ? <div className="day-empty"><h3>{tx('noSessions')}</h3><p>{tx('noSessionsNote')}</p></div> : null}
    {Object.keys(data.clients ?? {}).length ? <section className="day-section section-agents">
      <header className="day-section-head"><div><h3>{tx('cardAgents')}</h3><p>{tx(sortBy === 'cost' ? 'subAgentsCost' : 'subAgentsTokens', { period: dayLabel(locale, day) })}</p></div><span className="section-count">{Object.keys(data.clients).length} AGENTS</span></header>
      <AgentTable clients={data.clients} models={data.models} pricing={data.pricing} sortBy={sortBy} onSort={onSort} agentLabel={agentLabel} tx={tx} open={open} onToggle={onToggle} />
    </section> : null}
    {hasModelComparison(data.models) ? <section className="day-section section-models">
      <header className="day-section-head"><div><h3>{tx('cardModels')}</h3><p>{tx(sortBy === 'cost' ? 'subAgentsCost' : 'subAgentsTokens', { period: dayLabel(locale, day) })}</p></div><span className="section-count">{data.models.length} MODELS</span></header>
      <ModelTable models={data.models} pricing={data.pricing} sortBy={sortBy} onSort={onSort} agentLabel={agentLabel} tx={tx} />
    </section> : null}
    {sessions.length ? <section className="day-section section-sessions"><header className="day-section-head"><div><h3>{tx('secSessions')}</h3><p>{tx('shownSessions', { shown: visible.length, total: fmtInt(data.totals.sessions ?? sessions.length) })} · {tx('topSessionsNote')}</p></div>
      {sessions.length > 5 ? <button type="button" className="text-button no-export" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{tx(expanded ? 'hideSessions' : 'viewSessions')}</button> : null}</header>
      <ol className="session-list">{visible.map((row) => <SessionRow key={row.client + '/' + row.sessionId} row={row} agentLabel={agentLabel} locale={locale} tx={tx} timezone={data.timezone} />)}</ol>
    </section> : null}
  </div>;
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

export default function DayDetail({ day, report, nav, today, sortBy, onSort, onStep, onBack, locale, tx, agentLabel }) {
  const shown = report.data && report.day ? report : null;
  const stale = Boolean(shown) && (report.loading || shown.day !== day);
  const displayDay = shown?.day ?? day;
  const sub = [periodLabel(locale, { mode: 'year', year: Number(displayDay.slice(0, 4)) }), weekdayLabel(locale, displayDay), displayDay === today ? tx('dayToday') : null, shown?.data.timezone];
  // Keep expanded agents while moving between days.
  const [open, setOpen] = useState(() => new Set());
  const onToggle = useCallback(
    (id) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  return (
    <section className="xday" aria-label={dayLabel(locale, displayDay, true)}>
      <header className="xday-head">
        <div>
          <h3 className="xday-title" aria-live="polite" tabIndex={-1}>
            {dayLabel(locale, displayDay)}
          </h3>
          <p className="xday-sub">{sub.filter(Boolean).join(' · ')}</p>
        </div>
        <div className="xday-nav no-export">
          {onBack ? <button type="button" className="calendar-back" onClick={onBack}><ArrowUp {...icon} />{tx('backToCalendar')}</button> : null}
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
          <Kpis data={shown.data} tx={tx} grid />
          <DayBody data={shown.data} day={shown.day} sortBy={sortBy} onSort={onSort} locale={locale} tx={tx} agentLabel={agentLabel} open={open} onToggle={onToggle} />
        </div>
      ) : report.error ? null : (
        <DaySkeleton />
      )}
    </section>
  );
}
