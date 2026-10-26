import { useState } from 'react';
import { priceSourceLabel } from '@/lib/prices';
import { Button } from './ui';

export default function PriceSources({ tx, status, selected, disabled, onChange }) {
  return <fieldset className="price-source-options" disabled={disabled}>
    <legend className="label">{tx('priceChooseSources')}</legend>
    <p className="muted-note">{tx('priceSourcesNote')}</p>
    {(status.availableSources ?? []).map((source) => <label className="check" key={source}>
      <input type="checkbox" checked={selected.includes(source)} onChange={(event) => onChange(event.target.checked
        ? [...selected, source] : selected.filter((item) => item !== source))} />
      <span>{priceSourceLabel(source, tx)}</span>
    </label>)}
  </fieldset>;
}

export function PriceSourceSettings({ tx, status, busy, onSave }) {
  const [selected, setSelected] = useState(status.selectedSources ?? []);
  const changed = JSON.stringify([...selected].sort()) !== JSON.stringify([...(status.selectedSources ?? [])].sort());
  return <div className="price-source-settings">
    <PriceSources tx={tx} status={status} selected={selected} disabled={busy} onChange={setSelected} />
    <Button size="sm" disabled={busy || !changed} onClick={() => onSave(selected)}>{tx('priceSaveSources')}</Button>
  </div>;
}
