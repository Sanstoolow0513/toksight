'use client';

// Shared fixed-position chart tooltip: anchored at mouse coordinates,
// clamped to every viewport edge, never a hover target itself. Charts
// render their own rows as children (tip-title / tip-row classes). This
// replaces the laggy native `title` attribute used by the bar histograms so
// every chart on the page speaks the same tooltip language.

export default function Tip({ x = 0, y = 0, width = 230, children }) {
  // `100%` in translate() resolves to the tooltip's own width/height.
  return (
    <div
      className="tip"
      style={{
        left: 0,
        top: 0,
        transform: `translate(max(8px, min(${x + 12}px, calc(100vw - 100% - 8px))), max(8px, min(${y + 14}px, calc(100vh - 100% - 8px))))`,
      }}
    >
      {children}
    </div>
  );
}
