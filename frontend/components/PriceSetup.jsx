import PriceSources from './PriceSources';
import { useState } from 'react';
import { Database, Download, LoaderCircle } from 'lucide-react';

export default function PriceSetup({ tx, status, busy, error, onSetup }) {
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [selectedSources, setSelectedSources] = useState(status.selectedSources ?? []);
  return <section className="price-setup" aria-busy={busy}>
    <span className="setup-icon"><Database size={28} aria-hidden="true" /></span>
    <p className="setup-eyebrow">{tx('setupWelcome')}</p>
    <h2>{tx('setupTitle')}</h2>
    <p>{tx('setupDescription')}</p>
    <ol className="setup-steps">
      <li>{tx('setupLocal')}</li><li>{tx('setupSources')}</li><li>{tx('setupHistory')}</li>
    </ol>
    <PriceSources tx={tx} status={status} selected={selectedSources} disabled={busy} onChange={setSelectedSources} />
    {!status.offline ? <label className="setup-auto"><input type="checkbox" checked={autoUpdate} onChange={(e) => setAutoUpdate(e.target.checked)} disabled={busy} />{tx('priceAutoUpdate')}</label> : <p>{tx('setupOffline')}</p>}
    {error ? <p className="setup-error" role="alert">{error}</p> : null}
    <div className="setup-actions">
      {!status.offline ? <button type="button" className="btn-primary" disabled={busy} onClick={() => onSetup({ autoUpdate, selectedSources })}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{tx(busy ? 'setupBuilding' : 'setupBuild')}
      </button> : null}
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => onSetup({ offline: true, selectedSources, autoUpdate: status.offline ? true : autoUpdate })}>{tx('setupContinueOffline')}</button>
    </div>
    <p className="settings-note">{tx('setupNote')}</p>
  </section>;
}
