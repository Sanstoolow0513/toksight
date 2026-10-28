import { cx } from './cx';

// Label + control. The label uses the shared caption style; `inline` puts it
// beside the control.
export default function Field({ label, inline = false, hideLabel = false, className, children }) {
  return <label className={cx('field', inline && 'field--inline', className)}>
    <span className={hideLabel ? 'visually-hidden' : 'field-label'}>{label}</span>{children}
  </label>;
}
