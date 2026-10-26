import PriceSources from './PriceSources';
import { useState } from 'react';
import { Database, Download } from 'lucide-react';
import { Button } from './ui';

export default function PriceSetup({ tx, status, busy, error, onSetup }) {
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [selectedSources, setSelectedSources] = useState(status.selectedSources ?? []);
  return <section className="price-setup plate" aria-busy={busy}>
    <span className="setup-icon"><Database size={24} aria-hidden="true" /></span>
    <p className="setup-eyebrow label">{tx('setupWelcome')}</p>
    <h2>{tx('setupTitle')}</h2>
    <p className="setup-description">{tx('setupDescription')}</p>
    <ol className="setup-steps">
      <li>{tx('setupLocal')}</li><li>{tx('setupSources')}</li><li>{tx('setupHistory')}</li>
    </ol>
    <PriceSources tx={tx} status={status} selected={selectedSources} disabled={busy} onChange={setSelectedSources} />
    {!status.offline ? <label className="check"><input type="checkbox" checked={autoUpdate} onChange={(e) => setAutoUpdate(e.target.checked)} disabled={busy} />{tx('priceAutoUpdate')}</label> : <p className="muted-note">{tx('setupOffline')}</p>}
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    <div className="setup-actions">
      {!status.offline ? <Button variant="primary" loading={busy} icon={<Download size={15} />} onClick={() => onSetup({ autoUpdate, selectedSources })}>
        {tx(busy ? 'setupBuilding' : 'setupBuild')}
      </Button> : null}
      <Button disabled={busy} onClick={() => onSetup({ offline: true, selectedSources, autoUpdate: status.offline ? true : autoUpdate })}>{tx('setupContinueOffline')}</Button>
    </div>
    <p className="muted-note">{tx('setupNote')}</p>
  </section>;
}
