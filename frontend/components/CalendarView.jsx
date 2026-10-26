import { useMemo, useRef } from 'react';
import { ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { HeatGrid } from '@/components/HeatGrid';
import DayDetail from '@/components/DayDetail';
import { IconButton, Segmented, Stat } from '@/components/ui';
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
  const calendarRef = useRef(null);
  const detailRef = useRef(null);
  const trendRef = useRef(null);
  const scrollTo = (ref, focusTarget) => {
    const element = ref.current;
    if (!element) return;
    const inset = 76 + (window.matchMedia('(max-width: 700px)').matches ? document.querySelector('.sidebar').getBoundingClientRect().height : 0);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - inset), behavior: reducedMotion ? 'auto' : 'smooth' });
    if (focusTarget) element.querySelector(focusTarget)?.focus({ preventScroll: true });
  };
  const pickDay = (date, event) => {
    onPick(date);
    if (wide || window.matchMedia('(max-width: 1200px)').matches) {
      requestAnimationFrame(() => scrollTo(detailRef, event.detail === 0 ? '.xday-title' : null));
    }
  };
  return <div className={`calendar-workspace${wide ? ' is-wide' : ''}`}>
    <section className="calendar-summary plate" aria-label={tx('rangeSummary')}>
      <dl className="readouts" style={{ '--cols': 2 }}>
        <Stat label={tx('rangeTokens')} value={fmtTokens(data.totals.totalTokens)} />
        <Stat label={tx('rangeCost')} value={data.totals.pricedRequests ? fmtCost(data.totals.costUsd) : data.totals.requests ? tx('rowUnpriced') : fmtCost(0)} textValue={!data.totals.pricedRequests && data.totals.requests > 0} />
      </dl>
      <button type="button" className="btn btn--text summary-trend-link no-export" onClick={() => scrollTo(trendRef, 'h3')}>{tx('cardTrend')}<ArrowDown size={14} aria-hidden="true" /></button>
    </section>
    <section ref={calendarRef} className="calendar-overview plate">
      <header className="calendar-head">
        <div><h2>{periodLabel(locale, period)}</h2></div>
        <div className="calendar-controls no-export">
          <Segmented size="sm" label={tx('modeGroup')} value={period.mode} onChange={(mode) => { writeMode(mode); onPeriod(withMode(period, mode, today)); }}
            options={[{ value: 'month', label: tx('modeMonth') }, { value: 'year', label: tx('modeYear') }]} />
          {period.mode !== 'custom' ? <div className="period-nav">
            <IconButton outline size="sm" onClick={() => onPeriod(shiftPeriod(period, -1))} disabled={!nav.canPrev} label={tx('prev')}><ChevronLeft size={16} /></IconButton>
            <IconButton outline size="sm" onClick={() => onPeriod(shiftPeriod(period, 1))} disabled={!nav.canNext} label={tx('next')}><ChevronRight size={16} /></IconButton>
          </div> : null}
        </div>
      </header>
      <HeatGrid days={days} period={period} today={today} selected={day} onPick={pickDay} hint={tx('calendarHint')} locale={locale} tx={tx} />
    </section>
    <div ref={detailRef} className="calendar-detail">
      {day ? <DayDetail day={day} report={dayReport} nav={dayNav} today={today} onStep={onStep} locale={locale} tx={tx}
        onBack={() => scrollTo(calendarRef, '.is-selected')} {...shared} /> : null}
    </div>
    <div ref={trendRef} className="calendar-trends"><TrendCard data={data} period={period} today={today} locale={locale} tx={tx} /></div>
  </div>;
}
