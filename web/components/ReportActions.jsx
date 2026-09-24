import { useRef } from 'react';
import { DollarSign, ImageDown, LoaderCircle, Upload } from 'lucide-react';

const icon = { size: 17, strokeWidth: 1.9, 'aria-hidden': true };

export default function ReportActions({ tx, loading, priceUpdating, onUpdatePrices, importing, onImportCursor, exporting, onExport, canExport }) {
  const fileInput = useRef(null);

  return (
    <aside className="report-actions" aria-label={tx('reportActions')}>
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".csv,text/csv"
        tabIndex={-1}
        aria-label={tx('importCursor')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void onImportCursor(file);
        }}
      />
      <button type="button" className="report-action" onClick={() => fileInput.current?.click()} disabled={loading}>
        {importing ? <LoaderCircle {...icon} className="spin" /> : <Upload {...icon} />}
        <span>{tx(importing ? 'importingCursor' : 'importCursor')}</span>
      </button>
      <button type="button" className="report-action is-primary" onClick={onExport} disabled={!canExport || exporting}>
        {exporting ? <LoaderCircle {...icon} className="spin" /> : <ImageDown {...icon} />}
        <span>{tx(exporting ? 'exporting' : 'exportImage')}</span>
      </button>
      <button type="button" className="report-action" onClick={onUpdatePrices} disabled={loading}>
        {priceUpdating ? <LoaderCircle {...icon} className="spin" /> : <DollarSign {...icon} />}
        <span>{tx(priceUpdating ? 'updatingPrices' : 'updatePrices')}</span>
      </button>
    </aside>
  );
}
