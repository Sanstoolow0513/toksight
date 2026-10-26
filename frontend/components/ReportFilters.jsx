'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { periodBounds, periodOf, QUICK_RANGES, quickPeriod, validDay, validRange } from '@/lib/period';
import { Button, Field, Segmented } from './ui';

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
      <Field label={tx('filterSince')}><input type="date" required value={since} min="1000-01-01" max={until || today} onChange={(e) => setSince(e.target.value)} /></Field>
      <Field label={tx('filterUntil')}><input type="date" required value={until} min={since || '1000-01-01'} max={today} onChange={(e) => setUntil(e.target.value)} /></Field>
      <Button type="submit" disabled={!valid}>{tx('filterApply')}</Button>
      {!valid ? <span className="filter-error error-text" role="status">{tx('filterInvalid')}</span> : null}
    </form>
  );
}

export default function ReportFilters({ period, today, agent, clients, onAgent, onPeriod, onReset, tx }) {
  const { since, until } = periodBounds(period);
  return (
    <section className="report-filters plate plate--inset no-export" aria-label={tx('filterTitle')}>
      <div className="filter-row">
        <span className="filter-heading label"><SlidersHorizontal size={14} aria-hidden="true" />{tx('filterTitle')}</span>
        <Segmented size="sm" mono label={tx('filterQuick')} value={period.preset} onChange={(preset) => onPeriod(quickPeriod(preset, today))}
          className="quick-ranges" options={QUICK_RANGES.map((preset) => ({ value: preset, label: preset.toUpperCase(), title: tx(`range${preset}`) }))} />
        <Field inline label="Agent" className="agent-filter">
          <select value={agent} onChange={(e) => onAgent(e.target.value)}>
            <option value="">{tx('filterAllAgents')}</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.label}</option>)}
          </select>
        </Field>
        <Button variant="text" className="filter-reset" onClick={onReset}>{tx('filterReset')}</Button>
      </div>
      <div className="filter-row filter-dates">
        <Field inline label={tx('filterJump')} className="month-jump">
          <input type="month" min="1000-01" max={today.slice(0, 7)} value={until.slice(0, 7)} onChange={(e) => {
            const date = `${e.target.value}-01`;
            if (validDay(date) && date <= today) onPeriod(periodOf(date, 'month'));
          }} />
        </Field>
        <details className="custom-dates">
          <summary className="btn btn--text">{tx('filterCustom')}</summary>
          <DateFields key={`${since}/${until}`} period={period} today={today} onPeriod={onPeriod} tx={tx} />
        </details>
      </div>
    </section>
  );
}
