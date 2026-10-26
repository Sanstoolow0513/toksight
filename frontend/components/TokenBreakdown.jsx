import { ChartPie } from 'lucide-react';
import { TOKEN_PARTS } from '@/lib/report';
import { fmtPct, fmtTokens } from '@/lib/format';

const labels = ['compInput', 'compCacheRead', 'compCacheWrite', 'compOutput'];

export default function TokenBreakdown({ data, tx }) {
  const total = data.totals?.totalTokens || 0;
  let offset = 0;
  const parts = TOKEN_PARTS.map((key, i) => {
    const count = data.totals?.[key] || 0;
    const share = total ? count / total : 0;
    const part = { key, i, count, share, offset };
    offset += share * 100;
    return part;
  });
  return <section className="day-section section-breakdown">
    <header className="day-section-head"><div><h3><ChartPie size={17} />{tx('tokenMix')}</h3><p>{tx('tokenMixNote')}</p></div></header>
    <div className="token-breakdown">
      <div className="token-donut"><svg viewBox="0 0 180 180" role="img" aria-label={`${tx('tokenMix')} · ${fmtTokens(total)} Tokens`}>
        <circle className="donut-track" cx="90" cy="90" r="70" />
        {parts.filter((part) => part.count > 0).map((part) => <circle key={part.key} cx="90" cy="90" r="70" pathLength="100" className={`donut-part part-${part.i}`}
          strokeDasharray={`${Math.max(0.1, part.share * 100 - (part.share === 1 ? 0 : Math.min(1.4, part.share * 20)))} 100`} strokeDashoffset={-part.offset} transform="rotate(-90 90 90)">
          <title>{tx(labels[part.i])} · {fmtTokens(part.count)} · {fmtPct(part.share)}</title></circle>)}
      </svg><div className="donut-center"><strong>{fmtTokens(total)}</strong><span>Tokens</span></div></div>
      <dl className="token-legend">{parts.map((part) => <div key={part.key}><dt><i className={`part-${part.i}`} />{tx(labels[part.i])}</dt>
        <dd><strong>{fmtTokens(part.count)}</strong><span>{total ? fmtPct(part.share) : '—'}</span></dd></div>)}</dl>
    </div>
  </section>;
}
