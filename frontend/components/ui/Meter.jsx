import { cx } from './cx';

// Segmented gauge with role="meter". `value` is 0–100 or null (unknown).
export default function Meter({ label, value, valueText, high = 80, className }) {
  const clamped = value == null ? 0 : Math.max(0, Math.min(100, value));
  return <span className={cx('meter', value != null && value >= high && 'is-high', className)} role="meter" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={valueText}>
    <i style={{ '--value': clamped }} />
  </span>;
}
