'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

const BUTTON_TIP_DELAY = 300;
const BUTTON_TIP_GAP = 6;

// A raised label under a control: right-aligned 6px below it, kept inside
// the viewport (flipped above near the bottom edge).
export function AnchorTip({ anchor, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect(), t = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.right - t.width, window.innerWidth - 8 - t.width));
    const below = a.bottom + BUTTON_TIP_GAP;
    const top = below + t.height > window.innerHeight - 8 ? a.top - BUTTON_TIP_GAP - t.height : below;
    setPos({ left, top: Math.max(8, top) });
  }, [anchor, children]);
  return createPortal(
    <div ref={ref} className="btn-tip" role="tooltip" style={pos ?? { left: -9999, top: -9999 }}>{children}</div>,
    document.body,
  );
}

// Hover or keyboard focus shows the label after a short delay; pointer
// presses, blur and Escape hide it. Spread `handlers` on the control.
export function useButtonTip(delay = BUTTON_TIP_DELAY) {
  const [anchor, setAnchor] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const handlers = useMemo(() => {
    const show = (el) => { clearTimeout(timer.current); timer.current = setTimeout(() => setAnchor(el), delay); };
    const hide = () => { clearTimeout(timer.current); setAnchor(null); };
    return {
      onMouseEnter: (e) => show(e.currentTarget),
      onMouseLeave: hide,
      onFocus: (e) => { if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget); },
      onBlur: hide,
      onPointerDown: hide,
      onKeyDown: (e) => { if (e.key === 'Escape') hide(); },
    };
  }, [delay]);
  return { anchor, handlers };
}

// Run both handlers (ours first) for the events `useButtonTip` listens to.
export function mergeHandlers(own, rest) {
  const merged = {};
  for (const [name, fn] of Object.entries(own)) {
    const theirs = rest[name];
    merged[name] = theirs ? (e) => { fn(e); theirs(e); } : fn;
  }
  return merged;
}
