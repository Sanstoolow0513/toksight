import { GripVertical } from 'lucide-react';

// Chapter card: the number follows the card's current position, so a
// reordered (or exported) report still reads 01 → 02 → 03.
export default function Card({ index, title, subtitle, actions, handleProps, children }) {
  return (
    <section className="card">
      <header className="card-head">
        <div className="card-heading">
          <span className="card-no">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <h2 className="card-title">{title}</h2>
            <p className="card-sub">{subtitle}</p>
          </div>
        </div>
        <div className="card-actions no-export">
          {actions}
          <button type="button" className="drag-handle" {...handleProps}>
            <GripVertical size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </header>
      {children}
    </section>
  );
}
