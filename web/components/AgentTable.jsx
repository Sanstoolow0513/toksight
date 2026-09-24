import { Fragment, useId, useMemo, useState } from 'react';
import { ArrowDown, ChevronRight } from 'lucide-react';
import Tooltip from '@/components/Tooltip';
import { AgentDot, CacheRing, CostValue, PartsBar, PartsLegend, agentStyle } from '@/components/Marks';
import { TOKEN_PARTS, agentRows, modelsByAgent } from '@/lib/report';
import { fmtCost, fmtInt, fmtPct, fmtTokens } from '@/lib/format';

const RATE_PARTS = ['input', 'cacheRead', 'cacheWrite', 'output'];
const PART_LABELS = ['compInput', 'compCacheRead', 'compCacheWrite', 'compOutput'];
const SOURCE_NAMES = { litellm: 'LiteLLM', cursor: 'Cursor' };

function sourceLabel(source, tx) {
  if (source === 'builtin') return tx('sourceBuiltin');
  if (source === 'user') return tx('sourceUser');
  return SOURCE_NAMES[source] ?? source;
}

function commonRate(row, rates) {
  const variants = row.modelIds?.length ? row.modelIds : [row.model];
  const found = variants.map((id) => rates.get(`${row.client}\0${id}`));
  const first = found[0];
  return first?.source && found.every((rate) => rate?.source === first.source && RATE_PARTS.every((part) => rate[part] === first[part])) ? first : null;
}

function SortHeader({ id, sortBy, onSort, children }) {
  const active = sortBy === id;
  return (
    <th scope="col" className={`col-num col-${id}`} aria-sort={active ? 'descending' : undefined}>
      <button type="button" className={active ? 'sort-btn is-active' : 'sort-btn'} onClick={() => onSort(id)}>
        {children}
        <ArrowDown className="sort-arrow" size={12} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </th>
  );
}

function Cells({ row, tx }) {
  return (
    <>
      <td className="col-num">
        <span className="cell-value">{fmtTokens(row.totalTokens)}</span>
        <span className="cell-share">{fmtPct(row.tokenShare)}</span>
      </td>
      <td className="col-num">
        <CostValue row={row} tx={tx} />
        <span className="cell-share">{row.pricing === 'none' ? '—' : fmtPct(row.costShare)}</span>
      </td>
      <td className="col-mix">
        <PartsBar parts={row.parts} />
      </td>
      <td className="col-cache">
        <CacheRing rate={row.cacheHitRate} />
      </td>
      <td className="col-num col-req">{fmtInt(row.requests)}</td>
    </>
  );
}

// Absolute token classes (with per-million rates for a model whose IDs
// agree), cache hit, sessions and raw IDs live here instead of in the table.
function RowTip({ tip, tx }) {
  const { name, row, rate, mono } = tip;
  const ids = row.modelIds ?? [];
  return (
    <>
      <div className={mono ? 'tip-title is-mono' : 'tip-title'}>{name}</div>
      {TOKEN_PARTS.map((key, i) => (
        <div key={key} className="tip-row">
          <span>
            <i className={`tip-swatch part-${i}`} />
            {tx(PART_LABELS[i])}
          </span>
          <b>
            {fmtTokens(row[key])}
            {rate ? <em>{fmtCost(rate[RATE_PARTS[i]])}</em> : null}
          </b>
        </div>
      ))}
      <div className="tip-row"><span>{tx('tipCache')}</span><b>{fmtPct(row.cacheHitRate)}</b></div>
      <div className="tip-row"><span>{tx('tipRequests')}</span><b>{fmtInt(row.requests)} / {row.sessions ? fmtInt(row.sessions) : '—'}</b></div>
      {rate ? <div className="tip-note">{tx('tipRates', { source: sourceLabel(rate.source, tx) })}</div> : null}
      {ids.length > 1 ? <div className="tip-note is-mono">{ids.join(', ')}</div> : null}
    </>
  );
}

// One table for agents and their models. Each agent is a folder: its models
// start collapsed, sit in their own <tbody> and follow the same sort. The
// open set is keyed by agent id so it survives period and sort changes.
export default function AgentTable({ clients, models, pricing, sortBy, onSort, agentLabel, tx }) {
  const agents = useMemo(() => agentRows(clients, sortBy), [clients, sortBy]);
  const grouped = useMemo(() => modelsByAgent(models, sortBy), [models, sortBy]);
  const rates = useMemo(() => new Map((pricing?.modelRates ?? []).map((rate) => [`${rate.client}\0${rate.model}`, rate])), [pricing]);
  const [open, setOpen] = useState(() => new Set());
  const [tip, setTip] = useState(null);
  const listId = useId();
  if (!agents.length) return null;

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const tips = new Map();
  const onMove = (e) => {
    const key = e.target.closest?.('[data-tip]')?.dataset.tip;
    setTip(key ? { key, x: e.clientX, y: e.clientY } : null);
  };

  const body = agents.map((agent) => {
    const group = grouped.get(agent.id);
    const name = agentLabel(agent.id);
    const expandable = Boolean(group?.count);
    const expanded = expandable && open.has(agent.id);
    const id = `${listId}-${agent.id}`;
    const style = agentStyle(agent.id);
    tips.set(`a:${agent.id}`, { name, row: agent });
    if (group?.others) tips.set(`o:${agent.id}`, { name: tx('others', { n: group.others.count }), row: group.others });
    const label = (
      <>
        <span className="agent-caret">
          {expandable ? <ChevronRight className="agent-chevron no-export" size={14} strokeWidth={2.2} aria-hidden="true" /> : null}
        </span>
        <AgentDot id={agent.id} />
        <span className="agent-name">{name}</span>
        {expandable ? <span className="agent-count">{tx('rowModels', { n: fmtInt(group.count) })}</span> : null}
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
          </tr>
        </tbody>
        {expandable ? (
          <tbody id={id} className="model-group" style={style} hidden={!expanded} aria-label={tx('agentModels', { agent: name })}>
            {group.rows.map((row) => {
              tips.set(row.id, { name: row.model, row, rate: commonRate(row, rates), mono: true });
              return (
                <tr key={row.id} className="model-row" data-tip={row.id}>
                  <th scope="row" className="col-name">
                    <span className="model-name" title={row.model}>{row.model}</span>
                  </th>
                  <Cells row={row} tx={tx} />
                </tr>
              );
            })}
            {group.others ? (
              <tr className="model-row is-muted" data-tip={`o:${agent.id}`}>
                <th scope="row" className="col-name">
                  <span className="model-name">{tx('others', { n: group.others.count })}</span>
                </th>
                <Cells row={group.others} tx={tx} />
              </tr>
            ) : null}
          </tbody>
        ) : null}
      </Fragment>
    );
  });
  const current = tip ? tips.get(tip.key) : null;

  return (
    <div className="agent-table-wrap">
      <table className="agent-table" onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
        <thead>
          <tr>
            <th scope="col" className="col-name">{tx('colAgent')}</th>
            <SortHeader id="tokens" sortBy={sortBy} onSort={onSort}>{tx('colTokens')}</SortHeader>
            <SortHeader id="cost" sortBy={sortBy} onSort={onSort}>{tx('colCost')}</SortHeader>
            <th scope="col" className="col-mix">{tx('colMix')}</th>
            <th scope="col" className="col-cache">{tx('colCache')}</th>
            <th scope="col" className="col-num col-req">{tx('colRequests')}</th>
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
