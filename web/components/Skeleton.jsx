'use client';

// First-paint skeleton: pulses in the shape of the KPI strip plus the trend
// card. Only shown before any data arrives — refreshes keep the old data and
// signal progress via the masthead spinner.

export default function Skeleton() {
  return (
    <>
      <div className="skel-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <div className="skel" style={{ height: 11, width: 76, marginBottom: 10 }} />
            <div className="skel" style={{ height: 26, width: 120 }} />
          </div>
        ))}
      </div>
      <div className="skel-cell">
        <div className="skel" style={{ height: 14, width: 140, marginBottom: 20 }} />
        <div className="skel" style={{ height: 300 }} />
      </div>
    </>
  );
}
