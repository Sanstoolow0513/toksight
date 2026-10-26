import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cx } from './cx';

// One readout inside a <dl className="readouts">: label, large value,
// optional delta ({ dir: 'up' | 'down', text, title }) and one sub line.
export default function Stat({ label, icon, value, textValue = false, delta, sub, scale = false, size = 'md', className }) {
  return <div className={cx('readout', size !== 'md' && `readout--${size}`, className)}>
    <dt><span>{label}</span>{icon}</dt>
    <dd>
      <div className="readout-line">
        <span className={cx('readout-value', textValue && 'is-text')}>{value}</span>
        {delta ? <span className={cx('delta', delta.dir === 'up' && 'is-up')} title={delta.title}>
          {delta.dir === 'down' ? <ArrowDownRight size={12} aria-hidden="true" /> : <ArrowUpRight size={12} aria-hidden="true" />}{delta.text}</span> : null}
      </div>
      {scale ? <span className="readout-scale" aria-hidden="true" /> : null}
      {sub ? <span className="readout-sub">{sub}</span> : null}
    </dd>
  </div>;
}
