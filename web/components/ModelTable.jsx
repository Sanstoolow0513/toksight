import { Fragment, useId, useMemo, useState } from 'react';
import Tooltip from '@/components/Tooltip';
import { AgentDot, PartsLegend } from '@/components/Marks';
import { Cells, RowInfo, RowInfoButton, RowTip, SortHeader, commonRate } from '@/components/AgentTable';
import { modelRows } from '@/lib/report';
import { useTableColumns } from '@/lib/useTableColumns';

// Flat model table shared by Today and Calendar.
export default function ModelTable({ models, pricing, sortBy, onSort, agentLabel, tx }) {
  const { rows } = useMemo(() => modelRows(models, sortBy, Infinity), [models, sortBy]);
  const rates = useMemo(() => new Map((pricing?.modelRates ?? []).map((rate) => [`${rate.client}\0${rate.model}`, rate])), [pricing]);
  const [tip, setTip] = useState(null);
  const [detail, setDetail] = useState(null);
  const listId = useId();
  const { ref: tableRef, columns } = useTableColumns(rows.length > 0);
  if (!rows.length) return null;

  const tips = new Map();
  const onMove = (e) => {
    if (e.target.closest?.('.row-info-btn,.row-details-content')) return setTip(null);
    const key = e.target.closest?.('[data-tip]')?.dataset.tip;
    setTip(key ? { key, x: e.clientX, y: e.clientY } : null);
  };
  const body = rows.map((row, index) => {
    tips.set(row.id, { name: `${agentLabel(row.client)} · ${row.model}`, row, rate: commonRate(row, rates), mono: true });
    const id = `${listId}-detail-${index}`;
    return (
      <Fragment key={row.id}><tr className="agent-row is-flat-model" data-tip={row.id}>
        <th scope="row" className="col-name">
          <span className="model-name is-flat" title={row.model}>
            <AgentDot id={row.client} />
            <span className="model-text">{row.model}</span>
          </span>
        </th>
        <Cells row={row} tx={tx} />
        <RowInfoButton id={id} expanded={detail === row.id} onToggle={() => { setTip(null); setDetail((previous) => previous === row.id ? null : row.id); }} name={tips.get(row.id).name} tx={tx} />
      </tr><RowInfo id={id} expanded={detail === row.id} tip={tips.get(row.id)} tx={tx} columns={columns} /></Fragment>
    );
  });
  const current = tip ? tips.get(tip.key) : null;

  return (
    <div className="agent-table-wrap">
      <table ref={tableRef} className="agent-table" onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
        <thead>
          <tr>
            <th scope="col" className="col-name">{tx('colModel')}</th>
            <SortHeader id="tokens" sortBy={sortBy} onSort={onSort}>
              {tx('colTokens')}
            </SortHeader>
            <SortHeader id="cost" sortBy={sortBy} onSort={onSort}>
              {tx('colCost')}
            </SortHeader>
            <th scope="col" className="col-mix">{tx('colMix')}</th>
            <th scope="col" className="col-cache">{tx('colCache')}</th>
            <th scope="col" className="col-num col-req">{tx('colRequests')}</th>
            <th scope="col" className="col-info no-export"><span className="visually-hidden">{tx('details')}</span></th>
          </tr>
        </thead>
        <tbody className="agent-group">{body}</tbody>
      </table>
      <PartsLegend tx={tx}>
        <span className="legend-hint no-export">{tx('modelHint')}</span>
      </PartsLegend>
      {current ? (
        <Tooltip x={tip.x} y={tip.y}>
          <RowTip tip={current} tx={tx} />
        </Tooltip>
      ) : null}
    </div>
  );
}
