import { useEffect, useId, useRef } from 'react';
import { Database, X } from 'lucide-react';
import { Button, IconButton } from './ui';

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
    <dialog ref={ref} className="dialog plate" aria-labelledby={title} aria-describedby={description}
      aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="dialog-head">
        <Database size={20} aria-hidden="true" />
        <h2 id={title}>{tx('importDatabase')}</h2>
        <IconButton label={tx('databaseCancel')} disabled={busy} onClick={onClose}><X size={18} /></IconButton>
      </div>
      <div className="database-file leader"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB · SQLite</span></div>
      <p id={description}>{tx('databaseImportDescription')}</p>
      <p className="dialog-note">{tx('databaseContents')}</p>
      {error ? <p className="error-text" role="alert">{tx('databaseImportFailed', { error })}</p> : null}
      <div className="dialog-actions">
        <Button disabled={busy} onClick={onClose}>{tx('databaseCancel')}</Button>
        <Button variant="primary" loading={busy} onClick={onImport}>
          {tx(busy ? 'importingDatabase' : 'databaseMerge')}
        </Button>
      </div>
    </dialog>
  );
}
