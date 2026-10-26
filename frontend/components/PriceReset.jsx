import { useEffect, useId, useRef } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { Button, IconButton } from './ui';

export default function PriceReset({ tx, busy, resetting, error, onReset, onClose }) {
  const ref = useRef(null), title = useId(), description = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="dialog plate" aria-labelledby={title} aria-describedby={description}
    aria-busy={resetting} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-head">
      <RotateCcw size={20} aria-hidden="true" />
      <h2 id={title}>{tx('priceReset')}</h2>
      <IconButton label={tx('databaseCancel')} disabled={busy} onClick={onClose}><X size={18} /></IconButton>
    </div>
    <p id={description}>{tx('priceResetConfirm')}</p>
    <p className="dialog-note">{tx('priceResetBackupNote')}</p>
    {error ? <p className="error-text" role="alert">{tx('priceResetFailed', { error })}</p> : null}
    <div className="dialog-actions">
      <Button disabled={busy} onClick={onClose}>{tx('databaseCancel')}</Button>
      <Button variant="danger" disabled={busy} loading={resetting} icon={<RotateCcw size={15} aria-hidden="true" />} onClick={onReset}>
        {tx(resetting ? 'priceResetting' : 'priceResetAction')}
      </Button>
    </div>
  </dialog>;
}
