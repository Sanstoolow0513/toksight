import { Fragment, useId, useMemo, useState } from 'react';
import { ArrowDown, ChevronRight, Info } from 'lucide-react';
import { TipRow, TipTitle, Tooltip, useTip } from '@/components/ui';
import { AgentDot, CacheRing, CostValue, PartsBar, PartsLegend, agentStyle } from '@/components/Marks';
import { TOKEN_PARTS, agentRows, modelsByAgent } from '@/lib/report';
import { fmtCost, fmtInt, fmtPct, fmtTokens } from '@/lib/format';
import { useTableColumns } from '@/lib/useTableColumns';
import { priceSourceLabel } from '@/lib/prices';

export const ROW_TIP_IGNORE = '.row-info-btn,.row-details-content';
const RATE_PARTS = ['input', 'cacheRead', 'cacheWrite', 'output'];
const PART_LABELS = ['compInput', 'compCacheRead', 'compCacheWrite', 'compOutput'];

function commonRate(row, rates) {
  const variants = row.modelIds?.length ? row.modelIds : [row.model];
  const found = variants.map((id) => rates.get(`${row.client}\0${id}`));
  const first = found[0];
  return first?.source && found.every((rate) => rate?.source === first.source && RATE_PARTS.every((part) => rate[part] === first[part])) ? first : null;
}

export { commonRate };

export function SortHeader({ id, sortBy, onSort, children }) {
  const active = sortBy === id;
  return (
    <th scope="col" className={`num col-num col-${id}`} aria-sort={active ? 'descending' : undefined}>
      <button type="button" className={active ? 'sort-btn is-active' : 'sort-btn'} onClick={() => onSort(id)}>
        {children}
        <ArrowDown className="sort-arrow" size={12} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </th>
  );
}

export function Cells({ row, tx }) {
  return (
    <>
      <td className="num col-num">
        <span className="cell-value">{fmtTokens(row.totalTokens)}</span>
        <span className="cell-share">{fmtPct(row.tokenShare)}</span>
      </td>
      <td className="num col-num">
        <CostValue row={row} tx={tx} />
        <span className="cell-share">{row.pricing === 'none' ? '—' : fmtPct(row.costShare)}</span>
      </td>
      <td className="col-mix">
        <PartsBar parts={row.parts} />
      </td>
      <td className="col-cache">
        <CacheRing rate={row.cacheHitRate} />
      </td>
      <td className="num col-num col-req">{fmtInt(row.requests)}</td>
    </>
  );
}

// Absolute token classes (with per-million rates for a model whose IDs
// agree), cache hit, sessions and raw IDs live here instead of in the table.
export function RowTip({ tip, tx }) {
  const { name, row, rate, mono } = tip;
  const ids = row.modelIds ?? [];
  return (
    <>
      <TipTitle mono={mono}>{name}</TipTitle>
      <TipRow label={tx('tipTokens')}>{fmtTokens(row.totalTokens)}</TipRow>
      <TipRow label={tx('kpiCost')}><CostValue row={row} tx={tx} /></TipRow>
      {TOKEN_PARTS.map((key, i) => (
        <TipRow key={key} label={<><i className={`swatch part-${i}`} />{tx(PART_LABELS[i])}</>}>
          {fmtTokens(row[key])}
          {rate ? <em>{fmtCost(rate[RATE_PARTS[i]])}</em> : null}
        </TipRow>
      ))}
      <TipRow label={tx('tipCache')}>{fmtPct(row.cacheHitRate)}</TipRow>
      <TipRow label={tx('tipRequests')}>{fmtInt(row.requests)} / {row.sessions ? fmtInt(row.sessions) : '—'}</TipRow>
      {rate ? <div className="tip-note">{tx('tipRates', { source: priceSourceLabel(rate.source, tx) })}</div> : null}
      {ids.length && (ids.length > 1 || ids[0] !== row.model) ? <div className="tip-note is-mono">{ids.join(', ')}</div> : null}
    </>
  );
}

export function RowInfoButton({ id, expanded, onToggle, name, tx }) {
  return <td className="col-info no-export"><button type="button" className="icon-btn icon-btn--sm row-info-btn" aria-expanded={expanded} aria-controls={expanded ? id : undefined}
    aria-label={tx('rowDetails', { name })} title={tx('rowDetails', { name })} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
    <Info size={15} aria-hidden="true" /></button></td>;
}

export function RowInfo({ id, expanded, tip, tx, columns }) {
  if (!expanded) return null;
  return <tr className="row-details-row no-export"><td colSpan={columns}><div id={id} className="row-details-content" role="region" aria-label={tx('rowDetails', { name: tip.name })}>
    <RowTip tip={tip} tx={tx} />
  </div></td></tr>;
}

// One table for agents and their models. Each agent is a folder: its models
// start collapsed, sit in their own <tbody> and follow the same sort. The
// open set is keyed by agent id so it survives period and sort changes.
// `open` / `onToggle` optionally keep expansion controlled by the parent.
export default function AgentTable({ clients, models, pricing, sortBy, onSort, agentLabel, tx, open: openProp, onToggle: onToggleProp }) {
  const agents = useMemo(() => agentRows(clients, sortBy), [clients, sortBy]);
  const grouped = useMemo(() => modelsByAgent(models, sortBy), [models, sortBy]);
  const rates = useMemo(() => new Map((pricing?.modelRates ?? []).map((rate) => [`${rate.client}\0${rate.model}`, rate])), [pricing]);
  const [openState, setOpenState] = useState(() => new Set());
  const { tip, hide, track } = useTip();
  const [detail, setDetail] = useState(null);
  const listId = useId();
  const { ref: tableRef, columns } = useTableColumns(agents.length > 0);
  const open = openProp ?? openState;
  const toggle =
    onToggleProp ??
    ((id) =>
      setOpenState((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }));
  if (!agents.length) return null;
  const tips = new Map();
  const toggleDetail = (key) => { hide(); setDetail((previous) => previous === key ? null : key); };
  const body = agents.map((agent, agentIndex) => {
    const group = grouped.get(agent.id);
    const name = agentLabel(agent.id);
    const expandable = Boolean(group?.count);
    const expanded = expandable && open.has(agent.id);
    const id = `${listId}-${agent.id}`;
    const detailId = `${listId}-detail-${agentIndex}`;
    const style = agentStyle(agent.id);
    tips.set(`a:${agent.id}`, { name, row: agent });
    if (group?.others) tips.set(`o:${agent.id}`, { name: tx('others', { n: group.others.count }), row: group.others });
    const label = (
      <>
        <span className="agent-caret">
          {expandable ? <ChevronRight className="agent-chevron no-export" size={14} strokeWidth={2.2} aria-hidden="true" /> : null}
        </span>
        <span className="agent-label"><span className="agent-title"><AgentDot id={agent.id} /><span className="agent-name">{name}</span>
          {group?.count > 1 ? <span className="agent-count">{tx('rowModels', { n: fmtInt(group.count) })}</span> : null}</span>
          {group?.count === 1 ? <span className="agent-model-summary" title={group.rows[0].model}>{group.rows[0].model}</span> : null}</span>
      </>
    );
    return (
      <Fragment key={agent.id}>
        <tbody className="agent-group" style={style}>
          {/* Clicks anywhere on the row, including the disclosure button, bubble here. */}
          <tr className={expandable ? 'agent-row is-expandable' : 'agent-row'} data-tip={`a:${agent.id}`} onClick={expandable ? () => toggle(agent.id) : undefined}>
            <th scope="row" className="col-name">
              {expandable ? (
                <button type="button" className="agent-toggle" aria-expanded={expanded} aria-controls={id}>
                  {label}
                </button>
              ) : (
                <span className="agent-toggle">{label}</span>
              )}
            </th>
            <Cells row={agent} tx={tx} />
            <RowInfoButton id={detailId} expanded={detail === `a:${agent.id}`} onToggle={() => toggleDetail(`a:${agent.id}`)} name={name} tx={tx} />
          </tr>
          <RowInfo id={detailId} expanded={detail === `a:${agent.id}`} tip={tips.get(`a:${agent.id}`)} tx={tx} columns={columns} />
        </tbody>
        {expandable ? (
          <tbody id={id} className="model-group" style={style} hidden={!expanded} aria-label={tx('agentModels', { agent: name })}>
            {group.rows.map((row, modelIndex) => {
              tips.set(row.id, { name: row.model, row, rate: commonRate(row, rates), mono: true });
              const modelDetailId = `${detailId}-model-${modelIndex}`;
              return (
                <Fragment key={row.id}><tr className="model-row" data-tip={row.id}>
                  <th scope="row" className="col-name">
                    <span className="model-name" title={row.model}>{row.model}</span>
                  </th>
                  <Cells row={row} tx={tx} />
                  <RowInfoButton id={modelDetailId} expanded={detail === row.id} onToggle={() => toggleDetail(row.id)} name={row.model} tx={tx} />
                </tr><RowInfo id={modelDetailId} expanded={detail === row.id} tip={tips.get(row.id)} tx={tx} columns={columns} /></Fragment>
              );
            })}
            {group.others ? (
              <tr className="model-row is-muted" data-tip={`o:${agent.id}`}>
                <th scope="row" className="col-name">
                  <span className="model-name">{tx('others', { n: group.others.count })}</span>
                </th>
                <Cells row={group.others} tx={tx} />
                <RowInfoButton id={`${detailId}-others`} expanded={detail === `o:${agent.id}`} onToggle={() => toggleDetail(`o:${agent.id}`)} name={tx('others', { n: group.others.count })} tx={tx} />
              </tr>
            ) : null}
            {group.others ? <RowInfo id={`${detailId}-others`} expanded={detail === `o:${agent.id}`} tip={tips.get(`o:${agent.id}`)} tx={tx} columns={columns} /> : null}
          </tbody>
        ) : null}
      </Fragment>
    );
  });
  const current = tip ? tips.get(tip.key) : null;

  return (
    <div className="agent-table-wrap">
      <table ref={tableRef} className="agent-table ledger" {...track('tip', { ignore: ROW_TIP_IGNORE })}>
        <thead>
          <tr>
            <th scope="col" className="col-name">{tx('colAgent')}</th>
            <SortHeader id="tokens" sortBy={sortBy} onSort={onSort}>{tx('colTokens')}</SortHeader>
            <SortHeader id="cost" sortBy={sortBy} onSort={onSort}>{tx('colCost')}</SortHeader>
            <th scope="col" className="col-mix">{tx('colMix')}</th>
            <th scope="col" className="col-cache">{tx('colCache')}</th>
            <th scope="col" className="num col-num col-req">{tx('colRequests')}</th>
            <th scope="col" className="col-info no-export"><span className="visually-hidden">{tx('details')}</span></th>
          </tr>
        </thead>
        {body}
      </table>
      <PartsLegend tx={tx}>
        {agents.some((agent) => agent.pricing === 'partial') ? <span className="legend-note">{tx('partialNote')}</span> : null}
        <span className="legend-hint no-export">{tx('agentHint')}</span>
      </PartsLegend>
      {current ? (
        <Tooltip x={tip.x} y={tip.y}>
          <RowTip tip={current} tx={tx} />
        </Tooltip>
      ) : null}
    </div>
  );
}
