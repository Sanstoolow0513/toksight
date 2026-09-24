'use client';

import { memo, useMemo, useState } from 'react';
import Card from '@/components/Card';
import Tooltip from '@/components/Tooltip';
import { calendarWeeks, periodBounds } from '@/lib/period';
import { cacheHitRate, dailyMap, heatLevel, heatSummary, metricValue } from '@/lib/report';
import { fmtCost, fmtCostShort, fmtInt, fmtPct, fmtTokens } from '@/lib/format';
import { MONTHS, WEEKDAYS, dayLabel, periodLabel, weekdayLabel } from '@/lib/i18n';

function Stat({ label, value, sub }) {
  return (
    <div className="heat-stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  );
}

function cellClass(base, level, date, today, selected) {
  let cls = `${base} lv-${level}`;
  if (date > today) cls += ' is-future';
  if (date === today) cls += ' is-today';
  if (date === selected) cls += ' is-selected';
  return cls;
}

// Memoized so the hover tooltip re-renders only itself, not every cell.
// Past days are buttons (clicks bubble to the card's delegated handler).
const MonthGrid = memo(function MonthGrid({ weeks, days, max, today, selected, locale, tx }) {
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
            <span className="mcell-day">{Number(date.slice(8))}</span>
            {value > 0 ? (
              <span className="mcell-vals">
                <span className="mcell-val">{fmtTokens(value)}</span>
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

const YearGrid = memo(function YearGrid({ weeks, days, max, today, selected, locale, year }) {
  const monthCols = MONTHS[locale].map((label, m) => {
    const first = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    return { label, col: weeks.findIndex((week) => week.includes(first)) };
  });
  return (
    <div className="yheat-scroll">
      <div className="yheat" style={{ '--weeks': weeks.length }}>
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
              <i
                key={date}
                data-date={date}
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

export default function HeatmapCard({ data, period, today, selected, onSelect, locale, tx, handleProps }) {
  const [tip, setTip] = useState(null);
  const { since, until } = periodBounds(period);
  const days = useMemo(() => dailyMap(data.daily), [data.daily]);
  const weeks = useMemo(() => calendarWeeks(since, until), [since, until]);
  const summary = useMemo(() => heatSummary(days, { since, until, today }), [days, since, until, today]);
  const label = periodLabel(locale, period);

  const onMove = (e) => {
    const date = e.target.closest?.('[data-date]')?.dataset.date;
    if (!date) return setTip(null);
    setTip({ date, x: e.clientX, y: e.clientY });
  };
  const onClick = (e) => {
    const date = e.target.closest?.('[data-date]')?.dataset.date;
    if (date && date <= today) onSelect(date);
  };

  return (
    <Card
      handleProps={handleProps}
      title={tx('cardHeat')}
      subtitle={tx('subHeat', { period: label })}
    >
      <div className="heat-stats">
        <Stat label={tx('statActive')} value={tx('statActiveValue', { n: summary.activeDays, total: summary.elapsedDays })} />
        <Stat
          label={tx('statAverage')}
          value={summary.average ? fmtTokens(summary.average.tokens) : '—'}
          sub={summary.average ? fmtCost(summary.average.cost) : null}
        />
        <Stat
          label={tx('statPeak')}
          value={summary.peak ? fmtTokens(summary.peak.tokens) : '—'}
          sub={summary.peak ? `${dayLabel(locale, summary.peak.date)} · ${fmtCost(summary.peak.cost)}` : null}
        />
        <Stat label={tx('statStreak')} value={tx('statStreakValue', { n: summary.longestStreak })} />
      </div>
      <div
        className="heat-body"
        role="group"
        aria-label={tx('heatAria', { period: label })}
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
        onClick={onClick}
      >
        {period.mode === 'year' ? (
          <YearGrid weeks={weeks} days={days} max={summary.max} today={today} selected={selected} locale={locale} year={period.year} />
        ) : (
          <MonthGrid weeks={weeks} days={days} max={summary.max} today={today} selected={selected} locale={locale} tx={tx} />
        )}
      </div>
      <div className="heat-legend">
        <span className="heat-hint no-export">{tx('dayHint')}</span>
        <span>{tx('heatLess')}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} className={`lv-${level}`} />
        ))}
        <span>{tx('heatMore')}</span>
      </div>
      {tip ? (
        <Tooltip x={tip.x} y={tip.y}>
          <DayTip date={tip.date} row={days.get(tip.date)} today={today} locale={locale} tx={tx} />
        </Tooltip>
      ) : null}
    </Card>
  );
}
