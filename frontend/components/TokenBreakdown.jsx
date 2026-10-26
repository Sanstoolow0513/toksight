import { ChartPie } from 'lucide-react';
import { TOKEN_PARTS } from '@/lib/report';
import { fmtPct, fmtTokens } from '@/lib/format';
import { Panel } from './ui';

const labels = ['compInput', 'compCacheRead', 'compCacheWrite', 'compOutput'];

// Token mix as a spectrum band (one stacked bar) and a leader-dotted ledger.
export default function TokenBreakdown({ data, tx }) {
  const total = data.totals?.totalTokens || 0;
  const parts = TOKEN_PARTS.map((key, i) => {
    const count = data.totals?.[key] || 0;
    return { key, i, count, share: total ? count / total : 0 };
  });
  return <Panel className="day-section section-breakdown" icon={<ChartPie size={16} aria-hidden="true" />} title={tx('tokenMix')}>
    <div className="token-breakdown">
      <div className="token-total"><strong>{fmtTokens(total)}</strong><span className="label">Tokens</span></div>
      <div className="spectrum" role="img" aria-label={`${tx('tokenMix')} · ${parts.map((part) => `${tx(labels[part.i])} ${fmtPct(part.share)}`).join(' · ')}`}>
        {parts.filter((part) => part.count > 0).map((part) => <i key={part.key} className={`swatch part-${part.i}`} style={{ flexGrow: part.count }} title={`${tx(labels[part.i])} · ${fmtTokens(part.count)} · ${fmtPct(part.share)}`} />)}
      </div>
      <div className="spectrum-scale" aria-hidden="true"><span>0</span><span>50%</span><span>100%</span></div>
      <dl className="token-legend">{parts.map((part) => <div key={part.key} className="leader"><dt><i className={`swatch part-${part.i}`} />{tx(labels[part.i])}</dt>
        <dd><strong>{fmtTokens(part.count)}</strong><span>{total ? fmtPct(part.share) : '—'}</span></dd></div>)}</dl>
    </div>
  </Panel>;
}
