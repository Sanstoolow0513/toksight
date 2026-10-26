import { useState } from 'react';
import { priceSourceLabel } from '@/lib/prices';

export default function PriceSources({ tx, status, selected, disabled, onChange }) {
  return <fieldset className="price-source-options" disabled={disabled}>
    <legend>{tx('priceChooseSources')}</legend>
    <p className="settings-note">{tx('priceSourcesNote')}</p>
    {(status.availableSources ?? []).map((source) => <label className="setup-auto" key={source}>
      <input type="checkbox" checked={selected.includes(source)} onChange={(event) => onChange(event.target.checked
        ? [...selected, source] : selected.filter((item) => item !== source))} />
      <span>{priceSourceLabel(source, tx)}</span>
    </label>)}
  </fieldset>;
}

export function PriceSourceSettings({ tx, status, busy, onSave }) {
  const [selected, setSelected] = useState(status.selectedSources ?? []);
  const changed = JSON.stringify([...selected].sort()) !== JSON.stringify([...(status.selectedSources ?? [])].sort());
  return <div>
    <PriceSources tx={tx} status={status} selected={selected} disabled={busy} onChange={setSelected} />
    <button type="button" className="btn-secondary" disabled={busy || !changed} onClick={() => onSave(selected)}>{tx('priceSaveSources')}</button>
  </div>;
}
