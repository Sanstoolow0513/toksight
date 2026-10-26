import { ArrowUpRight } from 'lucide-react';
import Kpis from './Kpis';
import { DayBody } from './DayDetail';
import QuotaCard from './QuotaCard';
import { Button } from './ui';

export default function TodayDashboard({ data, day, onCalendar, quotaRevision, ...shared }) {
  return <><Kpis data={data} tx={shared.tx} size="lg" />
    <DayBody data={data} day={day} {...shared} overview quota={<QuotaCard revision={quotaRevision} timezone={data.timezone} locale={shared.locale} tx={shared.tx} />} />
    <div className="history-banner"><span className="label">{shared.tx('historyPrompt')}</span>
      <Button variant="text" className="no-export" onClick={onCalendar}>{shared.tx('browseCalendar')}<ArrowUpRight size={14} aria-hidden="true" /></Button></div></>;
}
