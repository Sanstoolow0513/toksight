import { ImageDown, RefreshCw, RotateCcw } from 'lucide-react';
import { IconButton } from './ui';

// Page-level actions in the app header: icon buttons whose text is the
// tooltip and accessible name. No primary/secondary distinction.
export default function PageActions({ view, tx, loading, refreshing, onRefresh, exporting, onExport, canExport, prices }) {
  if (view === 'prices') {
    const { busy, offline, updating, onReset, onUpdate } = prices;
    return <div className="header-actions" role="group" aria-label={tx('reportActions')}>
      <IconButton disabled={busy} label={tx('priceReset')} onClick={onReset}><RotateCcw /></IconButton>
      <IconButton disabled={busy || offline} busy={updating} label={offline ? tx('setupOffline') : tx(updating ? 'updatingPrices' : 'updatePrices')} onClick={onUpdate}><RefreshCw /></IconButton>
    </div>;
  }
  return <div className="header-actions" role="group" aria-label={tx('reportActions')}>
    {view !== 'settings' ? <IconButton onClick={onExport} disabled={!canExport} busy={exporting} label={tx(exporting ? 'exporting' : 'exportImage')}><ImageDown /></IconButton> : null}
    <IconButton onClick={onRefresh} disabled={loading} aria-busy={refreshing || undefined} label={tx(refreshing ? 'refreshing' : 'refresh')}><RefreshCw className={refreshing ? 'spin' : undefined} /></IconButton>
  </div>;
}
