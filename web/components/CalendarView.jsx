import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HeatGrid } from '@/components/HeatGrid';
import DayDetail from '@/components/DayDetail';
import Segmented from '@/components/Segmented';
import TrendCard from '@/components/TrendCard';
import { compactCalendar, periodNav, shiftPeriod, withMode } from '@/lib/period';
import { dailyMap } from '@/lib/report';
import { fmtCost, fmtTokens } from '@/lib/format';
import { periodLabel } from '@/lib/i18n';
import { writeMode } from '@/lib/prefs';

export default function CalendarView({ data, period, today, firstDay, day, onPick, dayReport, dayNav, onStep, onPeriod, locale, tx, ...shared }) {
  const days = useMemo(() => dailyMap(data.daily), [data.daily]);
  const nav = periodNav(period, { firstDay, today });
  const wide = compactCalendar(period);
  return <div className={`calendar-workspace${wide ? ' is-wide' : ''}`}>
    <section className="calendar-overview">
      <header className="calendar-head">
        <h2>{periodLabel(locale, period)}</h2>
        <div className="calendar-controls no-export">
          <Segmented label={tx('modeGroup')} value={period.mode} onChange={(mode) => { writeMode(mode); onPeriod(withMode(period, mode, today)); }}
            options={[{ value: 'month', label: tx('modeMonth') }, { value: 'year', label: tx('modeYear') }]} />
          {period.mode !== 'custom' ? <div className="period-nav">
            <button type="button" className="icon-btn" onClick={() => onPeriod(shiftPeriod(period, -1))} disabled={!nav.canPrev} aria-label={tx('prev')}><ChevronLeft size={16} /></button>
            <button type="button" className="icon-btn" onClick={() => onPeriod(shiftPeriod(period, 1))} disabled={!nav.canNext} aria-label={tx('next')}><ChevronRight size={16} /></button>
          </div> : null}
        </div>
      </header>
      <HeatGrid days={days} period={period} today={today} selected={day} onPick={onPick} hint={tx('calendarHint')} locale={locale} tx={tx} />
      <div className="calendar-summary"><div><span>{tx('rangeTokens')}</span><strong>{fmtTokens(data.totals.totalTokens)}</strong></div>
        <div><span>{tx('rangeCost')}</span><strong>{data.totals.pricedRequests ? fmtCost(data.totals.costUsd) : data.totals.requests ? tx('rowUnpriced') : fmtCost(0)}</strong></div></div>
      <TrendCard data={data} period={period} today={today} locale={locale} tx={tx} />
    </section>
    {day ? <DayDetail day={day} report={dayReport} nav={dayNav} today={today} onStep={onStep} locale={locale} tx={tx} {...shared} /> : null}
  </div>;
}
