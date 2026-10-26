import { ImageDown, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from './ui';

// Page-level actions, rendered in the app header. Labels collapse to icons
// on narrow screens (the text stays as the accessible name).
export default function PageActions({ view, tx, loading, refreshing, onRefresh, exporting, onExport, canExport, prices }) {
  const label = (key) => <span className="btn-label">{tx(key)}</span>;
  if (view === 'prices') {
    const { busy, offline, updating, onReset, onUpdate } = prices;
    return <div className="header-actions" role="group" aria-label={tx('reportActions')}>
      <Button disabled={busy} title={tx('priceReset')} icon={<RotateCcw size={15} />} onClick={onReset}>{label('priceReset')}</Button>
      <Button variant="primary" disabled={busy || offline} loading={updating} title={offline ? tx('setupOffline') : tx('updatePrices')} icon={<RefreshCw size={15} />} onClick={onUpdate}>
        {label(updating ? 'updatingPrices' : 'updatePrices')}</Button>
    </div>;
  }
  return <div className="header-actions" role="group" aria-label={tx('reportActions')}>
    {view !== 'settings' ? <Button onClick={onExport} disabled={!canExport} loading={exporting} title={tx('exportImage')} icon={<ImageDown size={15} />}>
      {label(exporting ? 'exporting' : 'exportImage')}</Button> : null}
    <Button variant="primary" onClick={onRefresh} disabled={loading} title={tx('refresh')} icon={<RefreshCw size={15} className={refreshing ? 'spin' : undefined} />}>
      {label(refreshing ? 'refreshing' : 'refresh')}</Button>
  </div>;
}
