import { DollarSign, ImageDown, LoaderCircle, RefreshCw } from 'lucide-react';

const icon = { size: 16, strokeWidth: 1.8, 'aria-hidden': true };

export default function ReportActions({ tx, loading, refreshing, onRefresh, priceUpdating, onUpdatePrices, exporting, onExport, canExport, settings }) {
  return <div className="report-actions" role="group" aria-label={tx('reportActions')}>
    <button type="button" className="report-action" onClick={onRefresh} disabled={loading}>
      <RefreshCw {...icon} className={refreshing ? 'spin' : undefined} /><span>{tx(refreshing ? 'refreshing' : 'refreshShort')}</span>
    </button>
    <button type="button" className="report-action" onClick={onUpdatePrices} disabled={loading}>
      {priceUpdating ? <LoaderCircle {...icon} className="spin" /> : <DollarSign {...icon} />}<span>{tx(priceUpdating ? 'updatingPrices' : 'updatePrices')}</span>
    </button>
    {!settings ? <button type="button" className="report-action" onClick={onExport} disabled={!canExport || exporting}>
      {exporting ? <LoaderCircle {...icon} className="spin" /> : <ImageDown {...icon} />}<span>{tx(exporting ? 'exporting' : 'exportImage')}</span>
    </button> : null}
  </div>;
}
