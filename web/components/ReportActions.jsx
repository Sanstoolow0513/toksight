import { useRef } from 'react';
import { DatabaseBackup, DatabaseZap, DollarSign, ImageDown, Import, LoaderCircle } from 'lucide-react';

const icon = { size: 17, strokeWidth: 1.9, 'aria-hidden': true };

export default function ReportActions({ tx, loading, priceUpdating, onUpdatePrices, importing, onImportCursor, exporting, onExport, canExport,
  databaseBusy, onImportDatabase, onExportDatabase }) {
  const fileInput = useRef(null);
  const databaseInput = useRef(null);

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
        {importing ? <LoaderCircle {...icon} className="spin" /> : <Import {...icon} />}
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
      <span className="report-action-label">{tx('databaseActions')}</span>
      <input ref={databaseInput} className="visually-hidden" type="file" accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3"
        tabIndex={-1} aria-label={tx('importDatabase')} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onImportDatabase(file);
        }} />
      <button type="button" className="report-action" onClick={() => databaseInput.current?.click()} disabled={loading}>
        {databaseBusy === 'import' ? <LoaderCircle {...icon} className="spin" /> : <DatabaseZap {...icon} />}
        <span>{tx(databaseBusy === 'import' ? 'importingDatabase' : 'importDatabase')}<small>{tx('databaseMergeHint')}</small></span>
      </button>
      <button type="button" className="report-action" onClick={onExportDatabase} disabled={loading}>
        {databaseBusy === 'export' ? <LoaderCircle {...icon} className="spin" /> : <DatabaseBackup {...icon} />}
        <span>{tx(databaseBusy === 'export' ? 'exportingDatabase' : 'exportDatabase')}<small>{tx('databaseAllHint')}</small></span>
      </button>
    </aside>
  );
}
