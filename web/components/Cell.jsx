'use client';

// One sheet cell: a white hairline card with a header (title + optional desc
// + right-aligned extra slot). span-N picks the width on the 12-col sheet
// grid. The head doubles as the drag handle in the dashboard grid; the body
// is the flexing/scrolling content area.

export default function Cell({ title, desc, extra, span = 12, children }) {
  return (
    <section className={`cell span-${span}`}>
      <div className="cell-head">
        <h2>{title}</h2>
        {desc ? <span className="cell-desc">{desc}</span> : null}
        {extra ? <div className="cell-extra">{extra}</div> : null}
      </div>
      <div className="cell-body">{children}</div>
    </section>
  );
}
