import { useEffect, useId, useRef } from 'react';
import { LoaderCircle, RotateCcw, X } from 'lucide-react';

export default function PriceReset({ tx, busy, resetting, error, onReset, onClose }) {
  const ref = useRef(null), title = useId(), description = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="database-dialog" aria-labelledby={title} aria-describedby={description}
    aria-busy={resetting} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="database-dialog-head">
      <RotateCcw size={22} aria-hidden="true" />
      <h2 id={title}>{tx('priceReset')}</h2>
      <button type="button" className="btn-icon" aria-label={tx('databaseCancel')} disabled={busy} onClick={onClose}><X size={18} /></button>
    </div>
    <p id={description}>{tx('priceResetConfirm')}</p>
    <p className="database-dialog-note">{tx('priceResetBackupNote')}</p>
    {error ? <p className="database-dialog-error" role="alert">{tx('priceResetFailed', { error })}</p> : null}
    <div className="database-dialog-actions">
      <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>{tx('databaseCancel')}</button>
      <button type="button" className="report-action is-primary" disabled={busy} onClick={onReset}>
        {resetting ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}
        {tx(resetting ? 'priceResetting' : 'priceResetAction')}
      </button>
    </div>
  </dialog>;
}
