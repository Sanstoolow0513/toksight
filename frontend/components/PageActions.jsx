import { ImageDown, RefreshCw } from 'lucide-react';
import { Button } from './ui';

export default function ReportActions({ tx, loading, refreshing, onRefresh, exporting, onExport, canExport, settings }) {
  return <div className="report-actions" role="group" aria-label={tx('reportActions')}>
    {!settings ? <Button onClick={onExport} disabled={!canExport} loading={exporting} icon={<ImageDown size={15} />}>
      <span>{tx(exporting ? 'exporting' : 'exportImage')}</span></Button> : null}
    <Button variant="primary" onClick={onRefresh} disabled={loading} icon={<RefreshCw size={15} className={refreshing ? 'spin' : undefined} />}>
      <span>{tx(refreshing ? 'refreshing' : 'refresh')}</span></Button>
  </div>;
}
