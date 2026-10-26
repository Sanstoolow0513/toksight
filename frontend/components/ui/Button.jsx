import { LoaderCircle } from 'lucide-react';
import { cx } from './cx';

export const buttonClass = (variant = 'secondary', size = 'md', className) =>
  cx('btn', `btn--${variant}`, size === 'sm' && 'btn--sm', className);

// One button for every text action. `icon` is a rendered element; `loading`
// swaps it for a spinner and disables the button.
export default function Button({ variant = 'secondary', size = 'md', icon, loading = false, disabled, className, type = 'button', children, ...rest }) {
  return <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
    {loading ? <LoaderCircle size={size === 'sm' ? 14 : 15} className="spin" aria-hidden="true" /> : icon}
    {children}
  </button>;
}

export const iconButtonClass = (size = 'md', outline = false, className) =>
  cx('icon-btn', size === 'sm' && 'icon-btn--sm', outline && 'icon-btn--outline', className);

// Icon-only button; `label` is both the accessible name and the hover title.
export function IconButton({ label, size = 'md', outline = false, className, type = 'button', children, ...rest }) {
  return <button type={type} className={iconButtonClass(size, outline, className)} aria-label={label} title={label} {...rest}>{children}</button>;
}
