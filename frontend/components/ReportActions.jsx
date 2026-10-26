import { ImageDown, LoaderCircle, RefreshCw } from 'lucide-react';

export default function ReportActions({ tx, loading, refreshing, onRefresh, exporting, onExport, canExport, settings }) {
  return <div className="report-actions" role="group" aria-label={tx('reportActions')}>
    {!settings ? <button type="button" className="btn-secondary" onClick={onExport} disabled={!canExport || exporting}>
      {exporting ? <LoaderCircle size={15} className="spin" /> : <ImageDown size={15} />}<span>{tx(exporting ? 'exporting' : 'exportImage')}</span></button> : null}
    <button type="button" className="btn-primary" onClick={onRefresh} disabled={loading}>
      <RefreshCw size={15} className={refreshing ? 'spin' : undefined} /><span>{tx(refreshing ? 'refreshing' : 'refresh')}</span></button>
  </div>;
}
