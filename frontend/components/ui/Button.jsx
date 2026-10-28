'use client';

import { LoaderCircle } from 'lucide-react';
import { cx } from './cx';
import { AnchorTip, mergeHandlers, useButtonTip } from './Tooltip';

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

export const iconButtonClass = (size = 'md', variant = 'solid', className) =>
  cx('icon-btn', size === 'sm' && 'icon-btn--sm', variant !== 'solid' && `icon-btn--${variant}`, className);

// The one icon-only button (page actions, preferences, steppers). `label` is
// the accessible name and the keyboard-reachable tooltip; `shortcut` adds a
// hint to the tooltip; `busy` swaps the icon for a spinner. Variants: solid
// (surface fill, default) or ghost (no fill).
export function IconButton({ label, shortcut, size = 'md', variant = 'solid', busy = false, className, type = 'button', children, ...rest }) {
  const { anchor, handlers } = useButtonTip();
  return <>
    <button type={type} className={iconButtonClass(size, variant, className)} aria-label={label} aria-busy={busy || undefined} {...rest} {...mergeHandlers(handlers, rest)}>
      {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : children}
    </button>
    {anchor ? <AnchorTip anchor={anchor}>{label}{shortcut ? <small>{shortcut}</small> : null}</AnchorTip> : null}
  </>;
}

// Same look and tooltip for a link (the project link in the header).
export function IconLink({ label, className, children, ...rest }) {
  const { anchor, handlers } = useButtonTip();
  return <>
    <a className={iconButtonClass('md', 'solid', className)} aria-label={label} {...rest} {...mergeHandlers(handlers, rest)}>{children}</a>
    {anchor ? <AnchorTip anchor={anchor}>{label}</AnchorTip> : null}
  </>;
}
