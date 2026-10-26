'use client';

import { memo, useMemo, useState } from 'react';


import Tooltip from '@/components/Tooltip';
import { calendarWeeks, compactCalendar, periodBounds } from '@/lib/period';
import { cacheHitRate, heatLevel, heatMax, metricValue } from '@/lib/report';
import { fmtCost, fmtCostShort, fmtInt, fmtPct, fmtTokens, fmtTokensShort } from '@/lib/format';
import { MONTHS, WEEKDAYS, dayLabel, periodLabel, weekdayLabel } from '@/lib/i18n';

function cellClass(base, level, date, today, selected) {
  let cls = `${base} lv-${level}`;
  if (date > today) cls += ' is-future';
  if (date === today) cls += ' is-today';
  if (date === selected) cls += ' is-selected';
  return cls;
}

// Memoized so the hover tooltip re-renders only itself, not every cell.
// Past days are buttons (clicks bubble to the grid's delegated handler).
const MonthGrid = memo(function MonthGrid({ weeks, days, max, today, selected, locale, tx, showMonth }) {
  return (
    <div className="mheat">
      {WEEKDAYS[locale].map((w) => (
        <span key={w} className="mheat-wd">{w}</span>
      ))}
      {weeks.flat().map((date, i) => {
        if (!date) return <span key={`pad-${i}`} className="mcell is-pad" />;
        const row = days.get(date);
        const value = metricValue(row, 'tokens');
        const cls = cellClass('mcell', heatLevel(value, max), date, today, selected);
        const body = (
          <>
            <span className="mcell-day">{showMonth ? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` : Number(date.slice(8))}</span>
            {value > 0 ? (
              <span className="mcell-vals">
                <span className="mcell-val" aria-hidden="true"><span className="mcell-val-full">{fmtTokens(value)}</span><span className="mcell-val-short">{fmtTokensShort(value)}</span><span className="mcell-val-tiny">{fmtTokensShort(value, 2)}</span></span>
                <span className="mcell-cost">{fmtCostShort(row.costUsd)}</span>
              </span>
            ) : null}
          </>
        );
        if (date > today) {
          return (
            <div key={date} data-date={date} className={cls}>
              {body}
            </div>
          );
        }
        return (
          <button
            key={date}
            type="button"
            data-date={date}
            className={cls}
            aria-pressed={date === selected}
            aria-label={`${dayLabel(locale, date, true)} · ${value > 0 ? `${fmtTokens(value)} tokens · ${fmtCost(row.costUsd)}` : tx('tipIdle')}`}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
});

const YearGrid = memo(function YearGrid({ weeks, days, max, today, selected, locale, tx }) {
  const monthCols = [];
  for (const [col, week] of weeks.entries()) {
    const date = week.find((key) => key?.endsWith('-01')) ?? (monthCols.length === 0 ? week.find(Boolean) : null);
    if (date) {
      if (monthCols.length && col - monthCols.at(-1).col < 3) monthCols.pop();
      monthCols.push({ label: MONTHS[locale][Number(date.slice(5, 7)) - 1], col });
    }
  }
  return (
    <div className="yheat-scroll">
      <div className="yheat" style={{ '--weeks': Math.max(53, weeks.length) }}>
        {monthCols.map(({ label, col }) => (
          <span key={label} className="yheat-month" style={{ gridColumn: col + 2 }}>
            {label}
          </span>
        ))}
        {[0, 2, 4].map((d) => (
          <span key={d} className="yheat-wd" style={{ gridRow: d + 2 }}>
            {WEEKDAYS[locale][d]}
          </span>
        ))}
        {weeks.map((week, w) =>
          week.map((date, d) =>
            date ? (
              <button
                key={date}
                type="button"
                data-date={date}
                disabled={date > today}
                aria-pressed={date === selected}
                aria-label={`${dayLabel(locale, date, true)} · ${fmtTokens(metricValue(days.get(date), 'tokens'))} tokens · ${days.get(date)?.requests ? fmtCost(days.get(date).costUsd) : tx('tipIdle')}`}
                className={cellClass('ycell', heatLevel(metricValue(days.get(date), 'tokens'), max), date, today, selected)}
                style={{ gridColumn: w + 2, gridRow: d + 2 }}
              />
            ) : null,
          ),
        )}
      </div>
    </div>
  );
});

function DayTip({ date, row, today, locale, tx }) {
  return (
    <>
      <div className="tip-title">
        {dayLabel(locale, date, true)} · {weekdayLabel(locale, date)}
      </div>
      {date > today ? (
        <div className="tip-muted">{tx('tipFuture')}</div>
      ) : !row?.requests ? (
        <div className="tip-muted">{tx('tipIdle')}</div>
      ) : (
        <>
          <div className="tip-row"><span>{tx('tipTokens')}</span><b>{fmtTokens(row.totalTokens)}</b></div>
          <div className="tip-row"><span>{tx('tipCost')}</span><b>{fmtCost(row.costUsd)}</b></div>
          <div className="tip-row"><span>{tx('tipRequests')}</span><b>{fmtInt(row.requests)} / {fmtInt(row.sessions)}</b></div>
          <div className="tip-row"><span>{tx('tipCache')}</span><b>{fmtPct(cacheHitRate(row))}</b></div>
        </>
      )}
    </>
  );
}

// Calendar grid, hover details and legend. Click or keyboard activation
// directly selects a day in the adjacent detail view.
export function HeatGrid({ days, period, today, selected, onPick, hint, active = true, locale, tx }) {
  const [tip, setTip] = useState(null);
  const { since, until } = periodBounds(period);
  const weeks = useMemo(() => calendarWeeks(since, until), [since, until]);
  const compact = compactCalendar(period);
  const years = useMemo(() => {
    if (!compact) return [];
    const groups = [];
    for (let year = Number(since.slice(0, 4)); year <= Number(until.slice(0, 4)); year++) {
      groups.push({ year, weeks: calendarWeeks(since > `${year}-01-01` ? since : `${year}-01-01`, until < `${year}-12-31` ? until : `${year}-12-31`) });
    }
    return groups;
  }, [since, until, compact]);
  const max = useMemo(() => heatMax(days), [days]);
  const label = periodLabel(locale, period);

  const onMove = (e) => {
    const date = e.target.closest?.('[data-date]')?.dataset.date;
    if (!date) return setTip(null);
    setTip({ date, x: e.clientX, y: e.clientY });
  };
  const onClick = (e) => {
    const date = e.target.closest?.('[data-date]')?.dataset.date;
    if (date && date <= today) { setTip(null); onPick(date, e); }
  };

  return (
    <>
      <div
        className="heat-body"
        role="group"
        aria-label={tx('heatAria', { period: label })}
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
        onClick={onClick}
      >
        {compact ? (
          years.map(({ year, weeks: yearWeeks }) => <div className="heat-year" key={year}>
            {years.length > 1 ? <p className="heat-year-label">{year}</p> : null}
            <YearGrid weeks={yearWeeks} days={days} max={max} today={today} selected={selected} locale={locale} tx={tx} />
          </div>)
        ) : (
          <MonthGrid weeks={weeks} days={days} max={max} today={today} selected={selected} locale={locale} tx={tx} showMonth={period.mode === 'custom'} />
        )}
      </div>
      <div className="heat-legend">
        <span className="heat-hint no-export">{hint}</span>
        <span>{tx('heatLess')}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} className={`lv-${level}`} />
        ))}
        <span>{tx('heatMore')}</span>
      </div>
      {tip && active ? (
        <Tooltip x={tip.x} y={tip.y}>
          <DayTip date={tip.date} row={days.get(tip.date)} today={today} locale={locale} tx={tx} />
        </Tooltip>
      ) : null}
    </>
  );
}
