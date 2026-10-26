import { ArrowUpRight, CircleDot } from 'lucide-react';
import Kpis from './Kpis';
import { DayBody } from './DayDetail';

export default function TodayDashboard({ data, day, onCalendar, ...shared }) {
  return <><Kpis data={data} tx={shared.tx} /><DayBody data={data} day={day} {...shared} overview />
    <div className="history-banner"><div><CircleDot size={18} /><span>{shared.tx('historyPrompt')}</span></div>
      <button type="button" className="text-button no-export" onClick={onCalendar}>{shared.tx('browseCalendar')}<ArrowUpRight size={15} /></button></div></>;
}
