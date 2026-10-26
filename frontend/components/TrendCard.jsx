import { useMemo } from 'react';
import { periodBounds } from '@/lib/period';
import { trendSeries } from '@/lib/report';
import { fmtCost, fmtTokens } from '@/lib/format';
import { periodLabel } from '@/lib/i18n';

function TrendPlot({ rows, metric, label, format, unit }) {
  const max = rows.reduce((value, row) => Math.max(value, row[metric]), 0);
  const width = 720;
  const height = 112;
  const step = width / Math.max(rows.length, 1);
  const tick = (row) => unit === 'Daily' ? row.key.slice(5) : row.key;
  return (
    <figure className={`trend-plot is-${metric}`}>
      <figcaption><span>{label}</span><span>{format(max)}</span></figcaption>
      <div className="chart-layout"><div className="chart-scale" aria-hidden="true"><span>{max > 0 ? format(max) : ''}</span><span>{max > 0 ? format(max / 2) : ''}</span><span>{format(0)}</span></div>
      <div><svg viewBox={`0 0 ${width} ${height + 2}`} role="img" aria-label={label} preserveAspectRatio="none">
        <title>{label}</title>
        {[0, 0.5, 1].map((ratio) => <line key={ratio} x1="0" x2={width} y1={ratio * height + 1} y2={ratio * height + 1} className="trend-guide" />)}
        {rows.map((row, i) => {
          const barHeight = max ? row[metric] / max * height : 0;
          return <rect key={row.key} x={i * step + step * 0.16} y={height - barHeight + 1} width={step * 0.68} height={barHeight} rx={Math.min(3, step / 5)} className="trend-bar">
            <title>{row.key} · {format(row[metric])}</title>
          </rect>;
        })}
      </svg>
      <div className="trend-axis"><span>{rows.length ? tick(rows[0]) : ''}</span><span>{rows.length > 1 ? tick(rows[rows.length - 1]) : ''}</span></div></div></div>
    </figure>
  );
}

export default function TrendCard({ data, period, today, locale, tx }) {
  const { since, until } = periodBounds(period);
  const series = useMemo(() => trendSeries(data.daily, data.hourly, { since, until, today }), [data.daily, data.hourly, since, until, today]);
  return (
    <section className="trend-section">
      <header className="trend-head"><h3 tabIndex={-1}>{tx('cardTrend')}</h3><p>{periodLabel(locale, period)} · {tx(`trend${series.unit}`)}</p></header>
      <div className="trend-charts">
        <TrendPlot rows={series.rows} metric="tokens" label={tx('trendTokens')} format={fmtTokens} unit={series.unit} />
        <TrendPlot rows={series.rows} metric="cost" label={tx('trendCost')} format={fmtCost} unit={series.unit} />
      </div>
    </section>
  );
}
