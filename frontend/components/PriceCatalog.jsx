import { PriceSourceSettings } from './PriceSources';
import { Fragment, useId, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, Search } from 'lucide-react';
import { fmtDateTime, fmtInt } from '@/lib/format';
import { WEEKDAYS } from '@/lib/i18n';
import { fmtUnitPrice, priceSourceLabel, priceSourceUrl } from '@/lib/prices';
import { usePriceCatalog } from '@/lib/usePriceCatalog';
import { Badge, Button, Field, IconButton, Panel, Stat } from './ui';

const parts = [['input', 'compInput'], ['output', 'compOutput'], ['cacheRead', 'compCacheRead'], ['cacheWrite', 'compCacheWrite']];
const pageSize = 50;
const clock = (value) => `${String(Math.floor(value / 100)).padStart(2, '0')}:${String(value % 100).padStart(2, '0')}`;
const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function Rate({ record, part, tx }) {
  const fallback = record[part + 'Fallback'];
  return <span title={fallback ? tx('priceCacheFallback') : undefined}>{fmtUnitPrice(record[part])}{fallback ? '*' : ''}</span>;
}

function Conditions({ record, tx, locale }) {
  const tiers = record.contextTiers ?? [], rules = record.official?.rules ?? [];
  return <div className="price-conditions">
    {record.official?.unresolvedLongContext ? <p>{tx('priceLongContextUnknown')}</p> : null}
    {record.official?.cacheWrite1h != null ? <p>{tx('priceCache1h', { rate: fmtUnitPrice(record.official.cacheWrite1h) })}</p> : null}
    {tiers.map((tier) => <p key={tier.contextOver}>{tx(tier.inclusive ? 'priceContextAtLeast' : 'priceContextOver', { n: fmtInt(tier.contextOver) })}{' · '}
      <span className="price-condition-rates">{parts.map(([part, label]) => <span key={part}>{tx(label)} <Rate record={tier} part={part} tx={tx} /></span>)}</span></p>)}
    {rules.length ? <p>{tx('priceRulesNote')}</p> : null}
    {rules.map((rule, i) => {
      const when = [
        rule.contextOver != null ? tx('priceContextOver', { n: fmtInt(rule.contextOver) }) : null,
        rule.utcStart != null ? `UTC ${clock(rule.utcStart)}–${clock(rule.utcEnd)}` : null,
        rule.utcDays ? rule.utcDays.map((day) => WEEKDAYS[locale][dayNames.indexOf(day)]).join(', ') : null,
      ].filter(Boolean).join(' · ');
      return <p key={i}>{when || tx('priceAlways')}{' → '}<span className="price-condition-rates">{parts.filter(([part]) => rule[part] != null).map(([part, label]) => <span key={part}>{tx(label)} <Rate record={rule} part={part} tx={tx} /></span>)}</span></p>;
    })}
  </div>;
}

function Details({ record, update, tx, locale }) {
  const url = priceSourceUrl(record, update), aliases = record.official?.aliases ?? [], names = record.names ?? [record.name];
  return <div className="price-details plate plate--inset">
    <dl>
      <div><dt>{tx('priceCatalogId')}</dt><dd>{names.map((name, i) => <Fragment key={name}>{i ? ', ' : null}<code>{name}</code></Fragment>)}</dd></div>
      <div><dt>{tx('priceChannel')}</dt><dd>{record.official?.channel || record.provider ? priceSourceLabel(record.official?.channel ?? record.provider, tx) : tx('priceGeneral')}</dd></div>
      <div><dt>{tx('priceSource')}</dt><dd>{priceSourceLabel(record.source, tx)}</dd></div>
      {record.official?.endpoint ? <div><dt>{tx('priceEndpoint')}</dt><dd>{record.official.endpoint}</dd></div> : null}
      {aliases.length ? <div><dt>{tx('priceAliases')}</dt><dd>{aliases.join(', ')}</dd></div> : null}
      {url ? <div><dt>{tx('priceViewSource')}</dt><dd><a href={url} target="_blank" rel="noreferrer">{url.replace(/^https:\/\//, '').split('/')[0]} <ExternalLink size={12} aria-hidden="true" /></a></dd></div> : null}
    </dl>
    {names.length > 1 ? <p className="price-note">{tx('priceMergedNote', { n: names.length })}</p> : null}
    {record.official?.retained ? <p className="price-note">{tx('priceRetainedNote')}</p> : null}
    {record.official?.reference ? <p className="price-note">{tx('priceReferenceNote')}</p> : null}
    <Conditions record={record} tx={tx} locale={locale} />
  </div>;
}

export default function PriceCatalog({ tx, timezone, locale, status, busy, error, onAutoUpdate, onSources, revision }) {
  const catalog = usePriceCatalog(null, revision);
  const [provider, setProvider] = useState('');
  const [query, setQuery] = useState(''), [page, setPage] = useState(0), [expanded, setExpanded] = useState(null);
  const [allModels, setAllModels] = useState(false);
  const prefix = useId();
  // One row per model; older servers without `models` fall back to raw rows.
  const models = useMemo(() => catalog.data ? catalog.data.models ?? catalog.data.records.map((row) => ({ ...row, names: [row.name], used: false })) : null, [catalog.data]);
  const usedCount = useMemo(() => (models ?? []).filter((row) => row.used).length, [models]);
  const usedOnly = usedCount > 0 && !allModels;
  const sources = useMemo(() => Object.keys(catalog.data?.updates ?? {}).sort(), [catalog.data?.updates]);
  const fetchedAt = catalog.data?.updates?.litellm?.fetchedAt ?? null;
  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (models ?? []).filter((row) => (!usedOnly || row.used) && (!provider || row.provider === provider) && words.every((word) =>
      [...(row.names ?? [row.name]), row.modelId, row.provider, row.official?.endpoint, ...(row.official?.aliases ?? [])].join(' ').toLowerCase().includes(word)));
  }, [models, query, provider, usedOnly]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * pageSize, (current + 1) * pageSize);
  const reset = () => { setPage(0); setExpanded(null); };
  return <div className="prices-content">
    <dl className="price-summary readouts plate" style={{ '--cols': 3 }}>
      <Stat label={tx('priceUsedModels')} value={models ? fmtInt(usedCount) : '—'} />
      <Stat label={tx('priceModels')} value={models ? fmtInt(models.length) : '—'} />
      <Stat label={tx('priceLastUpdated')} value={fetchedAt ? fmtDateTime(fetchedAt, timezone) : '—'} className="price-summary-time" />
    </dl>
    <Panel className="price-update-settings" title={tx('priceUpdateSettings')}>
      <div className="plate-body">
        <PriceSourceSettings key={JSON.stringify(status.selectedSources)} tx={tx} status={status} busy={busy} onSave={onSources} />
        <label className="check"><input type="checkbox" checked={status.autoUpdate} disabled={busy} onChange={(e) => onAutoUpdate(e.target.checked)} />{tx('priceAutoUpdate')}</label>
        <p className="muted-note">{tx(status.offline ? 'setupOffline' : 'priceAutoNote')}</p>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {status.warnings?.length ? <details className="price-warnings"><summary className="btn btn--text">{tx('priceUpdateWarnings', { count: status.warnings.length })}</summary><p className="error-text">{status.warnings.join('\n')}</p></details> : null}
        {sources.length ? <div className="price-sources">{sources.map((id) => {
          const update = catalog.data?.updates[id];
          return <div key={id} className="leader"><strong>{priceSourceLabel(id, tx)}</strong><span>{update?.fetchedAt ? fmtDateTime(update.fetchedAt, timezone) : tx(id === 'user' ? 'priceLocalSource' : 'priceNotFetched')}
            {update?.state === 'unavailable' ? <Badge tone="warn" className="price-source-warning">{tx('priceSourceUnavailable')}</Badge> : null}</span></div>;
        })}</div> : null}
      </div>
    </Panel>
    <Panel className="price-list" aria-busy={catalog.loading} level={2} title={tx('priceDatabaseTitle')} note={tx('priceUnits')}
      count={models ? fmtInt(filtered.length) : null}>
      <div className="plate-body">
      <div className="price-filters">
        <Field inline label={tx('priceProvider')} className="price-source-filter"><select value={provider} onChange={(e) => { setProvider(e.target.value); reset(); }}><option value="">{tx('priceAllProviders')}</option>{[...new Set((models ?? []).map((row) => row.provider).filter(Boolean))].sort().map((id) => <option key={id} value={id}>{priceSourceLabel(id, tx)}</option>)}</select></Field>
        <label className="price-search"><Search size={17} aria-hidden="true" /><span className="visually-hidden">{tx('priceSearch')}</span><input type="search" value={query} placeholder={tx('priceSearch')} onChange={(e) => { setQuery(e.target.value); reset(); }} /></label>
        {usedCount ? <label className="check"><input type="checkbox" checked={usedOnly} onChange={(e) => { setAllModels(!e.target.checked); reset(); }} />{tx('priceUsedOnly')}</label> : null}
      </div>
      <div className="price-result-status" role="status">{catalog.loading ? <><LoaderCircle size={14} className="spin" />{tx('priceLoading')}</> : null}</div>
      {catalog.error ? <p className="error-text" role="alert">{catalog.error} <Button variant="text" onClick={() => void catalog.reload()}>{tx('retry')}</Button></p> : null}
      <div className="price-table-scroll" role="region" aria-label={tx('priceDatabaseTitle')} tabIndex={0}>
        <table className="price-table ledger"><caption className="visually-hidden">{tx('priceUnits')}</caption><thead><tr><th scope="col">{tx('colModel')}</th><th scope="col">{tx('priceProvider')}</th>{parts.map(([part, label]) => <th key={part} scope="col" className="num">{tx(label)}</th>)}</tr></thead>
          <tbody>{rows.map((record, i) => {
            const open = expanded === record.id, detailId = `${prefix}-${current}-${i}`;
            return <Fragment key={record.id}><tr className={open ? 'is-expanded' : undefined}>
              <th scope="row"><button type="button" className="price-model" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => setExpanded(open ? null : record.id)}><ChevronRight size={15} className={open ? 'is-open' : undefined} aria-hidden="true" /><span>{record.name}</span></button>
                {record.used && !usedOnly ? <Badge className="price-model-note">{tx('priceUsedBadge')}</Badge> : null}
                {record.official?.endpoint ? <span className="price-model-note">{record.official.endpoint}</span> : null}
                {record.official?.retained ? <span className="price-model-note">{tx('priceRetained')}</span> : null}</th>
              <td>{record.provider ? priceSourceLabel(record.provider, tx) : priceSourceLabel(record.source, tx)}</td>{parts.map(([part]) => <td className="num price-number" key={part}><Rate record={record} part={part} tx={tx} /></td>)}
            </tr>{open ? <tr><td colSpan={6} id={detailId}><Details record={record} update={catalog.data.updates?.[record.source]} tx={tx} locale={locale} /></td></tr> : null}</Fragment>;
          })}{!rows.length && !catalog.loading && !catalog.error ? <tr><td colSpan={6} className="price-empty">{tx(models?.length ? 'priceNoResults' : 'priceDatabaseEmpty')}</td></tr> : null}</tbody>
        </table>
      </div>
      {filtered.length > pageSize ? <nav className="price-pagination" aria-label={tx('pricePages')}><IconButton outline label={tx('pricePrevious')} disabled={current === 0} onClick={() => { setPage(current - 1); setExpanded(null); }}><ChevronLeft size={16} /></IconButton><span>{tx('pricePage', { page: current + 1, pages })}</span><IconButton outline label={tx('priceNext')} disabled={current === pages - 1} onClick={() => { setPage(current + 1); setExpanded(null); }}><ChevronRight size={16} /></IconButton></nav> : null}
      <p className="price-note">{tx('priceCacheFallback')}</p>
      </div>
    </Panel>
  </div>;
}
