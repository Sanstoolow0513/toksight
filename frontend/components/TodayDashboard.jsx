import { ArrowUpRight } from 'lucide-react';
import Kpis from './Kpis';
import { DayBody } from './DayDetail';
import TrendCard from './TrendCard';
import { Button } from './ui';
import { fmtClock } from '@/lib/format';
import { dayLabel, weekdayLabel } from '@/lib/i18n';

// Today, all agents: the KPI panel (date and "as of" time in the reporting
// zone), hourly + token mix, agents/models, sessions, then the
// 30-day usage and cost trend.
export default function TodayDashboard({ data, day, today, trend, onCalendar, ...shared }) {
  const { locale, tx } = shared;
  const head = `${dayLabel(locale, day)} ${weekdayLabel(locale, day)} · ${tx('kpiAsOf', { time: fmtClock(data.generatedAt, data.timezone) })}`;
  return <>
    <Kpis data={data} tx={tx} size="lg" head={head} />
    <DayBody data={data} {...shared} />
    {trend?.data ? <div className="overview-trend"><TrendCard data={trend.data} period={{ mode: 'custom', since: trend.since, until: trend.until }} today={today} locale={locale} tx={tx} /></div> : null}
    <div className="history-banner"><span className="label">{tx('historyPrompt')}</span>
      <Button variant="text" className="no-export" onClick={onCalendar}>{tx('browseCalendar')}<ArrowUpRight size={14} aria-hidden="true" /></Button></div>
  </>;
}
