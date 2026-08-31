'use client';

// Shared motion helpers for the dashboard animations. Everything respects
// `prefers-reduced-motion` so the charts stay readable for users who opt out.

import { useEffect, useRef, useState } from 'react';

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// Eased count-up towards `target` (runs on mount and whenever the target
// moves). Returns the animated number; instant when reduced motion is set.
export function useCountUp(target, { duration = 900 } = {}) {
  const reduced = usePrefersReducedMotion();
  const shownRef = useRef(0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduced) {
      shownRef.current = target;
      setShown(target);
      return undefined;
    }
    const from = shownRef.current;
    if (from === target) return undefined;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else shownRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      shownRef.current = target;
      setShown(target);
    };
  }, [target, duration, reduced]);

  return shown;
}
