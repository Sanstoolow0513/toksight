'use client';

// Shared fixed-position chart tooltip: anchored at mouse coordinates,
// clamped to the right viewport edge, never a hover target itself. Charts
// render their own rows as children (tip-title / tip-row classes). This
// replaces the laggy native `title` attribute used by the bar histograms so
// every chart on the page speaks the same tooltip language.

export default function Tip({ x = 0, y = 0, width = 230, children }) {
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
  return (
    <div className="tip" style={{ left: Math.min(x + 12, vw - width), top: y + 14 }}>
      {children}
    </div>
  );
}
