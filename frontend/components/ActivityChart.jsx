import { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { hourlyBars } from '@/lib/report';
import { fmtCost, fmtInt, fmtTokens } from '@/lib/format';
import { Panel, Segmented, TipRow, TipTitle, Tooltip, useTip } from './ui';

const hourText = (hour) => `${String(hour).padStart(2, '0')}:00`;

// 24 local-hour columns on a tick ruler; the peak hour carries the signal colour.
export default function ActivityChart({ data, tx }) {
  const [metric, setMetric] = useState('tokens');
  const { tip, hide, atElement } = useTip();
  const { bars } = useMemo(() => hourlyBars(data.hourly), [data.hourly]);
  const value = (bar) => metric === 'tokens' ? bar.value : bar.row.costUsd || 0;
  const format = metric === 'tokens' ? fmtTokens : fmtCost;
  const max = Math.max(0, ...bars.map(value));
  const peak = max > 0 ? bars.find((bar) => value(bar) === max) : null;
  const current = tip ? bars[tip.key] : null;
  return <Panel className="day-section section-hourly" icon={<Activity size={16} aria-hidden="true" />} title={tx('secHourly')}
    actions={<div className="no-export"><Segmented size="sm" label={tx('metricLabel')} value={metric} onChange={setMetric} options={[{ value: 'tokens', label: 'Tokens' }, { value: 'cost', label: tx('kpiCost') }]} /></div>}>
    <div className="activity-chart" role="group" aria-label={tx('secHourly')} onMouseLeave={hide}>
      <div className="chart-scale" aria-hidden="true"><span>{format(max)}</span><span>{format(max / 2)}</span><span>{format(0)}</span></div>
      <div className="activity-plot"><div className="activity-guides" aria-hidden="true"><i /><i /><i /></div>
        <div className="activity-bars">{bars.map((bar) => <div key={bar.hour} className={'activity-hour' + (bar === peak ? ' is-peak' : '')} tabIndex={value(bar) > 0 ? 0 : undefined}
          role="img" aria-label={`${hourText(bar.hour)} · ${format(value(bar))}${metric === 'tokens' ? ' Tokens' : ''}`}
          onMouseEnter={(event) => atElement(bar.hour, event.currentTarget)} onFocus={(event) => atElement(bar.hour, event.currentTarget)} onBlur={hide}>
          {bar === peak ? <span className="peak-flag" aria-hidden="true">{format(max)}</span> : null}
          <div className="activity-bar" style={{ height: value(bar) > 0 ? `max(3px, ${value(bar) / max * 100}%)` : 0 }} />
        </div>)}</div>
        <div className="activity-ruler" aria-hidden="true" />
        <div className="activity-axis" aria-hidden="true">{[0, 6, 12, 18, 24].map((hour) => <span key={hour}>{hourText(hour)}</span>)}</div>
      </div>
      {current ? <Tooltip x={tip.x} y={tip.y}><TipTitle>{hourText(current.hour)} – {hourText(current.hour + 1)}</TipTitle>
        <TipRow label="Tokens">{fmtTokens(current.value)}</TipRow><TipRow label={tx('kpiCost')}>{fmtCost(current.row.costUsd || 0)}</TipRow>
        <TipRow label={tx('kpiRequests')}>{fmtInt(current.row.requests)}</TipRow></Tooltip> : null}
    </div>
    <div className="activity-footer"><span><i className="swatch" />{tx(metric === 'tokens' ? 'trendTokens' : 'trendCost')}</span>
      <span>{peak ? `${hourText(peak.hour)} · ${format(max)}` : tx('tipIdle')}{peak ? <b className="peak-label">{tx('peakLabel')}</b> : null}</span></div>
  </Panel>;
}
