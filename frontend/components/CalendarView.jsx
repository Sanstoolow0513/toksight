'use client';

import { useMemo } from 'react';
import Calendar from '@/components/Calendar';
import CalendarDetail from '@/components/CalendarDetail';
import { dailyMap } from '@/lib/report';

// Calendar column beside the detail pane; they stack below 1200px.
export default function CalendarView({ data, today, start, selected, anchor, zoom, onZoom, onSelect, report, agentLabel, locale, tx }) {
  const days = useMemo(() => dailyMap(data.daily), [data.daily]);
  return <div className="calendar-layout">
    <Calendar days={days} today={today} start={start} selected={selected} anchor={anchor} zoom={zoom} onZoom={onZoom} onSelect={onSelect} locale={locale} tx={tx} />
    <CalendarDetail report={report} selected={selected} days={days} today={today} start={start} timezone={data.timezone} onSelect={onSelect} agentLabel={agentLabel} locale={locale} tx={tx} />
  </div>;
}
