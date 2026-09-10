'use client';

// First-paint skeleton: pulses in the shape of the KPI strip plus the first
// two sheet cells. Only shown before any data arrives — filter switches and
// refreshes keep the old data and signal progress via the masthead spinner.

export default function Skeleton() {
  return (
    <>
      <div className="skel-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <div className="skel" style={{ height: 11, width: 76, marginBottom: 12 }} />
            <div className="skel" style={{ height: 34, width: 140 }} />
          </div>
        ))}
      </div>
      <div className="skel-cell">
        <div className="skel" style={{ height: 14, width: 140, marginBottom: 24 }} />
        <div className="skel" style={{ height: 300 }} />
      </div>
      <div className="skel-cell">
        <div className="skel" style={{ height: 14, width: 140, marginBottom: 24 }} />
        <div className="skel" style={{ height: 180 }} />
      </div>
    </>
  );
}
