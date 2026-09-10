'use client';

// One card: a white hairline block with a header (title + optional desc +
// right-aligned extra slot) and a content-sized body. `bodyClass` opts the
// body into internal columns (`cell-split` / `cell-trio`) whose `.cell-part`
// children are divided by hairlines; each part carries its own `.cell-sub`
// micro-label heading.

export default function Cell({ title, desc, extra, bodyClass, children }) {
  return (
    <section className="cell">
      <div className="cell-head">
        <h2>{title}</h2>
        {desc ? <span className="cell-desc">{desc}</span> : null}
        {extra ? <div className="cell-extra">{extra}</div> : null}
      </div>
      <div className={bodyClass ? `cell-body ${bodyClass}` : 'cell-body'}>{children}</div>
    </section>
  );
}
