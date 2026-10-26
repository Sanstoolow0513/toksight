import { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { hourlyBars } from '@/lib/report';
import { fmtCost, fmtInt, fmtTokens } from '@/lib/format';
import Tooltip from './Tooltip';
import Segmented from './Segmented';

const hourText = (hour) => `${String(hour).padStart(2, '0')}:00`;

export default function ActivityChart({ data, tx }) {
  const [metric, setMetric] = useState('tokens');
  const [tip, setTip] = useState(null);
  const { bars } = useMemo(() => hourlyBars(data.hourly), [data.hourly]);
  const value = (bar) => metric === 'tokens' ? bar.value : bar.row.costUsd || 0;
  const format = metric === 'tokens' ? fmtTokens : fmtCost;
  const max = Math.max(0, ...bars.map(value));
  const peak = max > 0 ? bars.find((bar) => value(bar) === max) : null;
  const current = tip ? bars[tip.hour] : null;
  return <section className="day-section section-hourly">
    <header className="day-section-head"><div><h3><Activity size={17} />{tx('secHourly')}</h3><p>{tx('activityNote')}</p></div>
      <div className="no-export"><Segmented label={tx('metricLabel')} value={metric} onChange={setMetric} options={[{ value: 'tokens', label: 'Tokens' }, { value: 'cost', label: tx('kpiCost') }]} /></div></header>
    <div className="activity-chart" role="group" aria-label={tx('secHourly')} onMouseLeave={() => setTip(null)}>
      <div className="chart-scale" aria-hidden="true"><span>{format(max)}</span><span>{format(max / 2)}</span><span>{format(0)}</span></div>
      <div className="activity-plot"><div className="activity-guides" aria-hidden="true"><i /><i /><i /></div>
        <div className="activity-bars">{bars.map((bar) => <div key={bar.hour} className={'activity-hour' + (bar === peak ? ' is-peak' : '')} tabIndex={value(bar) > 0 ? 0 : undefined}
          role="img" aria-label={`${hourText(bar.hour)} · ${format(value(bar))}${metric === 'tokens' ? ' Tokens' : ''}`}
          onMouseEnter={(event) => { const box = event.currentTarget.getBoundingClientRect(); setTip({ hour: bar.hour, x: box.left, y: box.top }); }}
          onFocus={(event) => { const box = event.currentTarget.getBoundingClientRect(); setTip({ hour: bar.hour, x: box.left, y: box.top }); }} onBlur={() => setTip(null)}>
          <div className="activity-bar" style={{ height: value(bar) > 0 ? `max(3px, ${value(bar) / max * 100}%)` : 0 }} />
        </div>)}</div>
        <div className="activity-axis" aria-hidden="true">{[0, 6, 12, 18, 24].map((hour) => <span key={hour}>{hourText(hour)}</span>)}</div>
      </div>
      {current ? <Tooltip x={tip.x} y={tip.y}><div className="tip-title">{hourText(current.hour)} – {hourText(current.hour + 1)}</div>
        <div className="tip-row"><span>Tokens</span><b>{fmtTokens(current.value)}</b></div><div className="tip-row"><span>{tx('kpiCost')}</span><b>{fmtCost(current.row.costUsd || 0)}</b></div>
        <div className="tip-row"><span>{tx('kpiRequests')}</span><b>{fmtInt(current.row.requests)}</b></div></Tooltip> : null}
    </div>
    <div className="activity-footer"><span><i />{tx(metric === 'tokens' ? 'trendTokens' : 'trendCost')}</span>
      <span>{peak ? `${hourText(peak.hour)} · ${format(max)}` : tx('tipIdle')}{peak ? <b className="peak-label">{tx('peakLabel')}</b> : null}</span></div>
  </section>;
}
