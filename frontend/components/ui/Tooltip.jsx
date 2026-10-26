'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

const OFFSET = 14;

// Rendered into <body>, outside the exported report, and flipped to stay
// inside the viewport.
export default function Tooltip({ x, y, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x + OFFSET, top: y + OFFSET });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = x + OFFSET + width > window.innerWidth - 8 ? x - OFFSET - width : x + OFFSET;
    const top = y + OFFSET + height > window.innerHeight - 8 ? y - OFFSET - height : y + OFFSET;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);
  return createPortal(
    <div ref={ref} className="tooltip" role="tooltip" style={pos}>
      {children}
    </div>,
    document.body,
  );
}

// The one place that tracks what a tooltip points at. `track(attr)` returns
// delegated pointer handlers that read `data-<attr>` from the hovered element
// (skipping targets matching `ignore`); `atElement` anchors to a focused node.
export function useTip() {
  const [tip, setTip] = useState(null);
  const hide = useCallback(() => setTip(null), []);
  const atElement = useCallback((key, element) => {
    const box = element.getBoundingClientRect();
    setTip({ key, x: box.left, y: box.top });
  }, []);
  const track = useCallback((attr, { ignore } = {}) => ({
    onMouseMove: (event) => {
      if (ignore && event.target.closest?.(ignore)) return setTip(null);
      const key = event.target.closest?.(`[data-${attr}]`)?.getAttribute(`data-${attr}`);
      setTip(key ? { key, x: event.clientX, y: event.clientY } : null);
    },
    onMouseLeave: () => setTip(null),
  }), []);
  return useMemo(() => ({ tip, hide, atElement, track }), [tip, hide, atElement, track]);
}

export function TipTitle({ mono = false, children }) {
  return <div className={cx('tip-title', mono && 'is-mono')}>{children}</div>;
}

export function TipRow({ label, children }) {
  return <div className="tip-row"><span>{label}</span><b>{children}</b></div>;
}
