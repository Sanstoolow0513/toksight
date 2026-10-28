import { PriceSourceSettings } from './PriceSources';
import { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Layers3, LoaderCircle, Search, Settings2 } from 'lucide-react';
import { fmtDateTime, fmtInt } from '@/lib/format';
import { WEEKDAYS } from '@/lib/i18n';
import { fmtTokenLimit, fmtUnitPrice, modelLogo, priceSourceLabel, priceSourceUrl, providerLogo, providerName } from '@/lib/prices';
import { usePriceCatalog } from '@/lib/usePriceCatalog';
import { Badge, Button, IconButton, MenuButton, cx } from './ui';
import ProviderLogo from './ProviderLogo';

const parts = [['input', 'compInput'], ['output', 'compOutput'], ['cacheRead', 'compCacheRead'], ['cacheWrite', 'priceCacheWriteShort']];
const PREVIEW = 5;
const clock = (value) => `${String(Math.floor(value / 100)).padStart(2, '0')}:${String(value % 100).padStart(2, '0')}`;
const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function Rate({ record, part, tx }) {
  const fallback = record[part + 'Fallback'];
  return <>{fmtUnitPrice(record[part])}{fallback ? <sup title={tx('priceCacheFallback')}>*</sup> : null}</>;
}

// Four unit prices (USD per million tokens), as a strip of cells.
function RateGrid({ record, tx, sub = false }) {
  return <dl className={cx('pgrid', sub && 'pgrid--sub')}>{parts.map(([part, label]) => <div className="pcell" key={part}>
    <dt title={tx(label)}>{tx(label)}</dt><dd><Rate record={record} part={part} tx={tx} /></dd></div>)}</dl>;
}

// Conditions other than long-context tiers (those have their own grids).
function Conditions({ record, tx, locale }) {
  const rules = record.official?.rules ?? [];
  if (!rules.length && record.official?.cacheWrite1h == null && !record.official?.unresolvedLongContext) return null;
  return <div className="price-conditions">
    {record.official?.unresolvedLongContext ? <p>{tx('priceLongContextUnknown')}</p> : null}
    {record.official?.cacheWrite1h != null ? <p>{tx('priceCache1h', { rate: fmtUnitPrice(record.official.cacheWrite1h) })}</p> : null}
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

function Details({ record, update, tx, locale, id }) {
  const url = priceSourceUrl(record, update), names = record.names ?? [record.name];
  const aliases = [...new Set([...(record.official?.aliases ?? []), ...(record.usedAs ?? [])])].filter((name) => !names.includes(name));
  const limit = record.maxInputTokens ? tx('priceMaxInput', { n: fmtInt(record.maxInputTokens) })
    : record.maxTokens ? tx('priceContextWindow', { n: fmtInt(record.maxTokens) }) : null;
  return <div className="cmore" id={id}>
    {(record.contextTiers ?? []).map((tier) => <div className="ctier" key={tier.contextOver}>
      <div className="ctier-label">{tx(tier.inclusive ? 'priceContextAtLeast' : 'priceContextOver', { n: fmtInt(tier.contextOver) })}</div>
      <RateGrid record={tier} tx={tx} sub />
    </div>)}
    <Conditions record={record} tx={tx} locale={locale} />
    <div className="cfacts"><span className="label">{tx('priceCatalogId')}</span>{names.map((name) => <code key={name}>{name}</code>)}
      {aliases.length ? <><span className="label">{tx('priceAliasUsed')}</span>{aliases.map((name) => <code key={name}>{name}</code>)}</> : null}
      {record.official?.endpoint ? <><span className="label">{tx('priceEndpoint')}</span><code>{record.official.endpoint}</code></> : null}</div>
    {names.length > 1 ? <p className="price-note">{tx('priceMergedNote', { n: names.length })}</p> : null}
    {record.official?.retained ? <p className="price-note">{tx('priceRetainedNote')}</p> : null}
    {record.official?.reference ? <p className="price-note">{tx('priceReferenceNote')}</p> : null}
    <div className="cfacts cfacts--foot"><span className="label">{[priceSourceLabel(record.source, tx), limit].filter(Boolean).join(' · ')}</span>
      {url ? <a className="price-source-link" href={url} target="_blank" rel="noreferrer">{tx('priceSourceShort')}<ExternalLink size={14} aria-hidden="true" /></a> : null}</div>
  </div>;
}

function ModelCard({ record, open, onToggle, update, tx, locale }) {
  const prefix = useId(), nameId = `${prefix}-name`, moreId = `${prefix}-more`;
  const tiers = record.contextTiers ?? [], names = record.names ?? [record.name];
  return <article className={cx('mcard', open && 'is-open', record.used && 'is-used')} aria-labelledby={nameId}>
    <div className="chead">
      <ProviderLogo logo={modelLogo(record)} letter={providerName(record.provider, tx) || record.name} size="lg" />
      <div className="ctitle">
        <span className="mname" id={nameId} title={record.name}>{record.name}</span>
        <span className="cprov">{record.provider ? providerName(record.provider, tx) : priceSourceLabel(record.source, tx)}
          {record.used ? <Badge tone="signal">{tx('priceUsedBadge')}</Badge> : null}
          {names.length > 1 ? <Badge>{tx('priceIdsBadge', { n: names.length })}</Badge> : null}
          {record.official?.retained ? <Badge tone="warn">{tx('priceRetained')}</Badge> : null}</span>
      </div>
      {!tiers.length ? <IconButton size="sm" variant="ghost" className={cx('cmore-toggle', open && 'is-open')} label={tx('priceDetails')}
        aria-expanded={open} aria-controls={open ? moreId : undefined} onClick={onToggle}><ChevronDown /></IconButton> : null}
    </div>
    <RateGrid record={record} tx={tx} />
    {tiers.length ? <div className="cfoot"><button type="button" className={cx('tier-pill', open && 'is-open')} aria-expanded={open} aria-controls={open ? moreId : undefined} onClick={onToggle}>
      <Layers3 size={14} aria-hidden="true" />{tx(tiers.length > 1 ? 'priceLongContextMore' : 'priceLongContext', { n: fmtTokenLimit(tiers[0].contextOver), count: tiers.length })}<ChevronDown size={14} aria-hidden="true" />
    </button></div> : null}
    {open ? <Details record={record} update={update} tx={tx} locale={locale} id={moreId} /> : null}
  </article>;
}

const providerKey = (row) => row.provider ?? '';

export default function PriceCatalog({ tx, timezone, locale, status, busy, error, onAutoUpdate, onSources, revision }) {
  const catalog = usePriceCatalog(null, revision);
  const [provider, setProvider] = useState(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [allModels, setAllModels] = useState(false);
  const scroller = useRef(null);
  // One row per model; older servers without `models` fall back to raw rows.
  const models = useMemo(() => catalog.data ? catalog.data.models ?? catalog.data.records.map((row) => ({ ...row, names: [row.name], used: false })) : null, [catalog.data]);
  const usedCount = useMemo(() => (models ?? []).filter((row) => row.used).length, [models]);
  const usedOnly = usedCount > 0 && !allModels;
  const sources = useMemo(() => Object.keys(catalog.data?.updates ?? {}).sort(), [catalog.data?.updates]);
  const fetchedAt = catalog.data?.updates?.litellm?.fetchedAt ?? null;
  // The switch decides which models count; providers with used models lead,
  // the rest follow by display name.
  const scoped = useMemo(() => (models ?? []).filter((row) => !usedOnly || row.used), [models, usedOnly]);
  const providers = useMemo(() => {
    const groups = new Map();
    for (const row of scoped) {
      const key = providerKey(row);
      if (!groups.has(key)) groups.set(key, { id: key, rows: [], used: 0, name: providerName(key, tx) });
      const group = groups.get(key);
      group.rows.push(row);
      if (row.used) group.used++;
    }
    return [...groups.values()].sort((a, b) => Number(b.used > 0) - Number(a.used > 0) || a.name.localeCompare(b.name, locale));
  }, [scoped, tx, locale]);
  const activeProvider = provider != null && providers.some((p) => p.id === provider) ? provider : null;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (row) => words.every((word) => [...(row.names ?? [row.name]), row.modelId, row.provider, row.official?.endpoint,
    ...(row.official?.aliases ?? []), ...(row.usedAs ?? [])].join(' ').toLowerCase().includes(word));
  const preview = !usedOnly && !words.length && activeProvider == null;
  const sections = providers.filter((p) => activeProvider == null || p.id === activeProvider)
    .map((p) => ({ ...p, matched: words.length ? p.rows.filter(matches) : p.rows })).filter((p) => p.matched.length);
  const toggle = (id) => setOpen((previous) => { const next = new Set(previous); if (!next.delete(id)) next.add(id); return next; });
  const pick = (id) => { setProvider(id); if (scroller.current) scroller.current.scrollTop = 0; };

  return <div className="prices-content">
    <section className="price-head plate">
      <div className="price-head-row">
        <div className="price-filters">
          <label className="price-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">{tx('priceSearch')}</span>
            <input type="search" value={query} placeholder={tx('priceSearch')} onChange={(e) => setQuery(e.target.value)} /></label>
          {usedCount ? <button type="button" role="switch" aria-checked={usedOnly} className="switch" onClick={() => { setAllModels(usedOnly); setProvider(null); }}>
            <span className="switch-track" aria-hidden="true" />{tx('priceUsedOnly')}</button> : null}
        </div>
        <div className="price-meta">
          <span className="label">{tx('priceHeaderMeta', { time: fetchedAt ? fmtDateTime(fetchedAt, timezone) : '—' })}</span>
          <MenuButton size="sm" label={tx('priceUpdateSettings')} icon={<Settings2 />} panelClassName="price-settings">
            <h2 className="price-settings-title">{tx('priceUpdateSettings')}</h2>
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
          </MenuButton>
        </div>
      </div>
      {providers.length ? <div className="chips" role="group" aria-label={tx('priceProvider')}>
        <button type="button" className="chip" aria-pressed={activeProvider == null} onClick={() => pick(null)}>{tx('priceAllChip')}<span className="chip-count">{fmtInt(scoped.length)}</span></button>
        {providers.map((p) => <button type="button" key={p.id} className="chip" aria-pressed={activeProvider === p.id} onClick={() => pick(p.id)}>
          <ProviderLogo logo={providerLogo(p.id)} letter={p.name} size="sm" />{providerName(p.id, tx, true)}<span className="chip-count">{fmtInt(p.rows.length)}</span></button>)}
      </div> : null}
    </section>
    <div className="price-scroll" ref={scroller} aria-busy={catalog.loading}>
      {catalog.loading && !models ? <p className="price-status" role="status"><LoaderCircle size={14} className="spin" aria-hidden="true" />{tx('priceLoading')}</p> : null}
      {catalog.error ? <p className="error-text" role="alert">{catalog.error} <Button variant="text" onClick={() => void catalog.reload()}>{tx('retry')}</Button></p> : null}
      {sections.map((section) => {
        const shown = preview ? section.matched.slice(0, PREVIEW) : section.matched;
        const rest = section.matched.length - shown.length;
        return <section className="price-section" key={section.id} aria-labelledby={`price-section-${section.id || 'other'}`}>
          <div className="price-section-head">
            <ProviderLogo logo={providerLogo(section.id)} letter={section.name} size="md" />
            <h3 id={`price-section-${section.id || 'other'}`}>{section.name}</h3>
            <span className="label">{tx('priceSectionCount', { n: fmtInt(section.matched.length) })}{!usedOnly && section.used ? ` · ${tx('priceSectionUsed', { n: fmtInt(section.used) })}` : ''}</span>
          </div>
          <div className={cx('mgrid', usedOnly && 'is-used-view')}>
            {shown.map((record) => <ModelCard key={record.id} record={record} open={open.has(record.id)} onToggle={() => toggle(record.id)}
              update={catalog.data?.updates?.[record.source]} tx={tx} locale={locale} />)}
            {rest > 0 ? <button type="button" className="more-tile" onClick={() => pick(section.id)}>
              <Layers3 size={15} aria-hidden="true" /><span>{tx('priceViewAll', { n: fmtInt(section.matched.length) })}</span>
              <span className="label">{tx('priceViewAllSub', { n: fmtInt(rest), provider: providerName(section.id, tx, true) })}</span></button> : null}
          </div>
        </section>;
      })}
      {models && !sections.length && !catalog.loading ? <p className="price-empty">{tx(models.length ? 'priceNoResults' : 'priceDatabaseEmpty')}</p> : null}
      {usedOnly && models ? <div className="price-hint"><p>{tx('priceUsedHint', { n: fmtInt(usedCount), total: fmtInt(models.length) })}</p>
        <p className="label">{tx('priceUsedHintNote')}</p></div> : null}
    </div>
  </div>;
}
