import { PriceSourceSettings } from './PriceSources';
import { Fragment, useId, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, Search } from 'lucide-react';
import { fmtDateTime, fmtInt } from '@/lib/format';
import { WEEKDAYS } from '@/lib/i18n';
import { fmtUnitPrice, priceSourceLabel, priceSourceUrl } from '@/lib/prices';
import { usePriceCatalog } from '@/lib/usePriceCatalog';

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

function History({ record, revision, tx, timezone, locale }) {
  const history = usePriceCatalog(record.id, revision);
  return <div className="price-history">
    <h3>{tx('priceHistory')}</h3><p>{tx('priceHistoryNote')}</p>
    {history.loading ? <p role="status"><LoaderCircle size={14} className="spin" /> {tx('priceLoading')}</p> : null}
    {history.error ? <p role="alert" className="setup-error">{history.error} <button type="button" className="filter-reset" onClick={() => void history.reload()}>{tx('retry')}</button></p> : null}
    {history.data?.history.length ? <div className="price-table-scroll" role="region" aria-label={tx('priceHistory')} tabIndex={0}>
      <table className="price-history-table"><thead><tr><th scope="col">{tx('priceObserved')}</th>{parts.map(([part, label]) => <th key={part} scope="col">{tx(label)}</th>)}</tr></thead>
        <tbody>{history.data.history.map((row) => <Fragment key={row.observedAt}><tr><th scope="row"><time dateTime={row.observedAt}>{fmtDateTime(row.observedAt, timezone)}</time></th>
          {parts.map(([part]) => <td key={part}><Rate record={row.record} part={part} tx={tx} /></td>)}</tr>
          <tr className="price-history-conditions"><td colSpan={5}><Conditions record={row.record} tx={tx} locale={locale} /></td></tr></Fragment>)}</tbody>
      </table></div> : !history.loading && !history.error ? <p>{tx('priceNoHistory')}</p> : null}
  </div>;
}

function Details({ record, update, revision, tx, timezone, locale }) {
  const url = priceSourceUrl(record, update), aliases = record.official?.aliases ?? [];
  return <div className="price-details">
    <dl>
      <div><dt>{tx('priceCatalogId')}</dt><dd><code>{record.name}</code></dd></div>
      <div><dt>{tx('priceChannel')}</dt><dd>{record.official?.channel || record.provider ? priceSourceLabel(record.official?.channel ?? record.provider, tx) : tx('priceGeneral')}</dd></div>
      {record.provider ? <div><dt>{tx('priceProvider')}</dt><dd>{priceSourceLabel(record.provider, tx)}</dd></div> : null}
      {record.official?.endpoint ? <div><dt>{tx('priceEndpoint')}</dt><dd>{record.official.endpoint}</dd></div> : null}
      {aliases.length ? <div><dt>{tx('priceAliases')}</dt><dd>{aliases.join(', ')}</dd></div> : null}
      {url ? <div><dt>{tx('priceSource')}</dt><dd><a href={url} target="_blank" rel="noreferrer">{tx('priceViewSource')} <ExternalLink size={12} aria-hidden="true" /></a></dd></div> : null}
    </dl>
    {record.official?.retained ? <p className="price-note">{tx('priceRetainedNote')}</p> : null}
    {record.official?.reference ? <p className="price-note">{tx('priceReferenceNote')}</p> : null}
    <Conditions record={record} tx={tx} locale={locale} />
    {record.revisions ? <History record={record} revision={revision} tx={tx} timezone={timezone} locale={locale} /> : <p className="price-note">{tx('priceNoHistory')}</p>}
  </div>;
}

export default function PriceCatalog({ tx, timezone, locale, status, busy, error, onAutoUpdate, onSources, revision }) {
  const catalog = usePriceCatalog(null, revision);
  const [provider, setProvider] = useState('');
  const [query, setQuery] = useState(''), [source, setSource] = useState(''), [page, setPage] = useState(0), [expanded, setExpanded] = useState(null);
  const prefix = useId();
  const records = catalog.data?.records;
  const sources = useMemo(() => [...new Set([...(records ?? []).map((row) => row.source), ...Object.keys(catalog.data?.updates ?? {})])].sort(), [records, catalog.data?.updates]);
  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (records ?? []).filter((row) => (!source || row.source === source) && (!provider || row.provider === provider) && words.every((word) =>
      [row.name, row.modelId, row.provider, row.official?.endpoint, ...(row.official?.aliases ?? [])].join(' ').toLowerCase().includes(word)))
      .sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
  }, [records, query, source, provider]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * pageSize, (current + 1) * pageSize);
  return <div className="prices-content">
    <div className="price-summary">
      <div><span>{tx('priceRecords')}</span><strong>{records ? fmtInt(records.length) : '—'}</strong></div>
      <div><span>{tx('priceRevisions')}</span><strong>{fmtInt(catalog.data?.status.revisions ?? status.revisions)}</strong></div>
      <div><span>{tx('priceLastChange')}</span><strong className="price-summary-time">{fmtDateTime(catalog.data?.status.observedAt ?? status.observedAt, timezone)}</strong></div>
    </div>
    <div className="price-update-settings">
      <PriceSourceSettings key={JSON.stringify(status.selectedSources)} tx={tx} status={status} busy={busy} onSave={onSources} />
      <label className="setup-auto"><input type="checkbox" checked={status.autoUpdate} disabled={busy} onChange={(e) => onAutoUpdate(e.target.checked)} />{tx('priceAutoUpdate')}</label>
      <p>{tx(status.offline ? 'setupOffline' : 'priceAutoNote')}</p>
      {error ? <p className="setup-error" role="alert">{error}</p> : null}
      {status.warnings?.length ? <details className="price-warnings"><summary>{tx('priceUpdateWarnings', { count: status.warnings.length })}</summary><p className="setup-error">{status.warnings.join('\n')}</p></details> : null}
    </div>
    {sources.length ? <div className="price-sources">{sources.map((id) => {
      const update = catalog.data?.updates[id];
      return <div key={id}><strong>{priceSourceLabel(id, tx)}</strong><span>{update?.fetchedAt ? fmtDateTime(update.fetchedAt, timezone) : tx(id === 'user' ? 'priceLocalSource' : 'priceNotFetched')}</span>
        {update?.state === 'unavailable' ? <span className="price-source-warning">{tx('priceSourceUnavailable')}</span> : null}</div>;
    })}</div> : null}
    <section className="price-list" aria-busy={catalog.loading}>
      <div className="price-list-heading"><h2>{tx('priceDatabaseTitle')}</h2><p>{tx('priceUnits')}</p></div>
      <div className="price-filters">
        <label className="price-source-filter"><span>{tx('priceProvider')}</span><select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(0); setExpanded(null); }}><option value="">{tx('priceAllProviders')}</option>{[...new Set((records ?? []).map((row) => row.provider).filter(Boolean))].sort().map((id) => <option key={id} value={id}>{priceSourceLabel(id, tx)}</option>)}</select></label>
        <label className="price-search"><Search size={17} aria-hidden="true" /><span className="visually-hidden">{tx('priceSearch')}</span><input type="search" value={query} placeholder={tx('priceSearch')} onChange={(e) => { setQuery(e.target.value); setPage(0); setExpanded(null); }} /></label>
        <label className="price-source-filter"><span>{tx('priceSource')}</span><select value={source} onChange={(e) => { setSource(e.target.value); setPage(0); setExpanded(null); }}><option value="">{tx('priceAllSources')}</option>{sources.map((id) => <option key={id} value={id}>{priceSourceLabel(id, tx)}</option>)}</select></label>
      </div>
      <div className="price-result-status" role="status">{catalog.loading ? <><LoaderCircle size={14} className="spin" />{tx('priceLoading')}</> : tx('priceResults', { n: fmtInt(filtered.length) })}</div>
      {catalog.error ? <p className="setup-error" role="alert">{catalog.error} <button type="button" className="filter-reset" onClick={() => void catalog.reload()}>{tx('retry')}</button></p> : null}
      <div className="price-table-scroll" role="region" aria-label={tx('priceDatabaseTitle')} tabIndex={0}>
        <table className="price-table"><caption className="visually-hidden">{tx('priceUnits')}</caption><thead><tr><th scope="col">{tx('colModel')}</th><th scope="col">{tx('priceSource')}</th>{parts.map(([part, label]) => <th key={part} scope="col">{tx(label)}</th>)}<th scope="col">{tx('priceObserved')}</th></tr></thead>
          <tbody>{rows.map((record, i) => {
            const open = expanded === record.id, detailId = `${prefix}-${current}-${i}`;
            return <Fragment key={record.id}><tr className={open ? 'is-expanded' : undefined}>
              <th scope="row"><button type="button" className="price-model" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => setExpanded(open ? null : record.id)}><ChevronRight size={15} className={open ? 'is-open' : undefined} aria-hidden="true" /><span>{record.name}</span></button>
                {record.official?.endpoint ? <span className="price-model-note">{record.official.endpoint}</span> : null}
                {record.official?.retained ? <span className="price-model-note">{tx('priceRetained')}</span> : null}</th>
              <td>{priceSourceLabel(record.source, tx)}</td>{parts.map(([part]) => <td className="price-number" key={part}><Rate record={record} part={part} tx={tx} /></td>)}
              <td className="price-observed">{record.observedAt ? <time dateTime={record.observedAt}>{fmtDateTime(record.observedAt, timezone)}</time> : '—'}{record.revisions > 0 ? <span>{tx('priceVersionCount', { n: record.revisions })}</span> : null}</td>
            </tr>{open ? <tr><td colSpan={7} id={detailId}><Details record={record} update={catalog.data.updates[record.source]} revision={revision} tx={tx} timezone={timezone} locale={locale} /></td></tr> : null}</Fragment>;
          })}{!rows.length && !catalog.loading && !catalog.error ? <tr><td colSpan={7} className="price-empty">{tx(records?.length ? 'priceNoResults' : 'priceDatabaseEmpty')}</td></tr> : null}</tbody>
        </table>
      </div>
      {filtered.length > pageSize ? <nav className="price-pagination" aria-label={tx('pricePages')}><button type="button" className="btn-secondary" disabled={current === 0} aria-label={tx('pricePrevious')} onClick={() => { setPage(current - 1); setExpanded(null); }}><ChevronLeft size={16} /></button><span>{tx('pricePage', { page: current + 1, pages })}</span><button type="button" className="btn-secondary" disabled={current === pages - 1} aria-label={tx('priceNext')} onClick={() => { setPage(current + 1); setExpanded(null); }}><ChevronRight size={16} /></button></nav> : null}
      <p className="price-note">{tx('priceCacheFallback')}</p><p className="price-note">{tx('priceHistoryNote')}</p>
    </section>
  </div>;
}
