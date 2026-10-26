'use client';

import { useState } from 'react';
import { CalendarDays, SlidersHorizontal } from 'lucide-react';
import { periodBounds, periodOf, QUICK_RANGES, quickPeriod, validDay, validRange } from '@/lib/period';

function DateFields({ period, today, onPeriod, tx }) {
  const bounds = periodBounds(period);
  const [since, setSince] = useState(bounds.since);
  const [until, setUntil] = useState(bounds.until > today ? today : bounds.until);
  const valid = validRange(since, until, today);
  return (
    <form className="date-range-form" onSubmit={(e) => {
      e.preventDefault();
      if (valid) onPeriod({ mode: 'custom', since, until });
    }}>
      <label>{tx('filterSince')}<input type="date" required value={since} min="1000-01-01" max={until || today} onChange={(e) => setSince(e.target.value)} /></label>
      <label>{tx('filterUntil')}<input type="date" required value={until} min={since || '1000-01-01'} max={today} onChange={(e) => setUntil(e.target.value)} /></label>
      <button type="submit" className="btn-secondary" disabled={!valid}>{tx('filterApply')}</button>
      {!valid ? <span className="filter-error" role="status">{tx('filterInvalid')}</span> : null}
    </form>
  );
}

export default function ReportFilters({ period, today, agent, clients, onAgent, onPeriod, onReset, tx }) {
  const { since, until } = periodBounds(period);
  return (
    <section className="report-filters no-export" aria-label={tx('filterTitle')}>
      <div className="filter-row">
        <span className="filter-heading"><SlidersHorizontal size={15} aria-hidden="true" />{tx('filterTitle')}</span>
        <div className="quick-ranges" role="group" aria-label={tx('filterQuick')}>
          {QUICK_RANGES.map((preset) => (
            <button key={preset} type="button" aria-pressed={period.preset === preset} title={tx(`range${preset}`)} onClick={() => onPeriod(quickPeriod(preset, today))}>
              {preset.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="agent-filter"><span>Agent</span>
          <select aria-label="Agent" value={agent} onChange={(e) => onAgent(e.target.value)}>
            <option value="">{tx('filterAllAgents')}</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}
          </select>
        </label>
        <button type="button" className="filter-reset" onClick={onReset}>{tx('filterReset')}</button>
      </div>
      <div className="filter-row filter-dates">
        <label className="month-jump"><CalendarDays size={15} aria-hidden="true" /><span>{tx('filterJump')}</span>
          <input type="month" aria-label={tx('filterJump')} min="1000-01" max={today.slice(0, 7)} value={until.slice(0, 7)} onChange={(e) => {
            const date = `${e.target.value}-01`;
            if (validDay(date) && date <= today) onPeriod(periodOf(date, 'month'));
          }} />
        </label>
        <details className="custom-dates">
          <summary>{tx('filterCustom')}</summary>
          <DateFields key={`${since}/${until}`} period={period} today={today} onPeriod={onPeriod} tx={tx} />
        </details>
      </div>
    </section>
  );
}
