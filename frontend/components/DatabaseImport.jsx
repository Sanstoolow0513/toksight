import { useEffect, useId, useRef } from 'react';
import { Database, LoaderCircle, X } from 'lucide-react';

export default function DatabaseImport({ file, error, busy, onImport, onClose, tx }) {
  const ref = useRef(null);
  const title = useId();
  const description = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className="database-dialog" aria-labelledby={title} aria-describedby={description}
      aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="database-dialog-head">
        <Database size={22} aria-hidden="true" />
        <h2 id={title}>{tx('importDatabase')}</h2>
        <button type="button" className="btn-icon" aria-label={tx('databaseCancel')} disabled={busy} onClick={onClose}><X size={18} /></button>
      </div>
      <div className="database-file"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB · SQLite</span></div>
      <p id={description}>{tx('databaseImportDescription')}</p>
      <p className="database-dialog-note">{tx('databaseContents')}</p>
      {error ? <p className="database-dialog-error" role="alert">{tx('databaseImportFailed', { error })}</p> : null}
      <div className="database-dialog-actions">
        <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>{tx('databaseCancel')}</button>
        <button type="button" className="report-action is-primary" disabled={busy} onClick={onImport}>
          {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : null}
          {tx(busy ? 'importingDatabase' : 'databaseMerge')}
        </button>
      </div>
    </dialog>
  );
}
