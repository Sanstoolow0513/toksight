import { cx } from './cx';

export default function Badge({ tone = 'neutral', className, children, ...rest }) {
  return <span className={cx('badge', tone !== 'neutral' && `badge--${tone}`, className)} {...rest}>{children}</span>;
}
