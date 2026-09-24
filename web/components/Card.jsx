import { GripVertical } from 'lucide-react';

export default function Card({ title, subtitle, actions, handleProps, children }) {
  return (
    <section className="card">
      <header className="card-head">
        <div className="card-heading">
          <h2 className="card-title">{title}</h2>
          <p className="card-sub">{subtitle}</p>
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
