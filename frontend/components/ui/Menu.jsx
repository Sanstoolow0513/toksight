'use client';

import { useEffect, useRef, useState } from 'react';
import { iconButtonClass } from './Button';
import { AnchorTip, useButtonTip } from './Tooltip';
import { cx } from './cx';

// An IconButton that opens a raised panel (theme menu, price sources).
// A <details> keeps it keyboard-operable; outside presses, focus leaving the
// menu and Escape close it (Escape returns focus to the button).
export default function MenuButton({ label, icon, size = 'md', className, panelClassName, children }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const { anchor, handlers } = useButtonTip();
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [open]);
  return <details ref={ref} className={cx('menu', className)} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}
    onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
    onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); ref.current.querySelector('summary').focus(); } }}>
    <summary className={iconButtonClass(size)} aria-label={label} {...handlers}>{icon}</summary>
    {anchor && !open ? <AnchorTip anchor={anchor}>{label}</AnchorTip> : null}
    <div className={cx('menu-panel', panelClassName)}>{children}</div>
  </details>;
}
