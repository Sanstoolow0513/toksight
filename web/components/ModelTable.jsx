import { useMemo, useState } from 'react';
import Tooltip from '@/components/Tooltip';
import { AgentDot, PartsLegend } from '@/components/Marks';
import { Cells, RowTip, SortHeader, commonRate } from '@/components/AgentTable';
import { modelRows } from '@/lib/report';

// Every model in the period across all agents on one flat table, ranked by
// the shared sort. Nothing folds into "others" here — this is the detailed
// view, and the deck hands it a scrolling page when it grows tall.
export default function ModelTable({ models, pricing, sortBy, onSort, agentLabel, tx }) {
  const { rows } = useMemo(() => modelRows(models, sortBy, Infinity), [models, sortBy]);
  const rates = useMemo(() => new Map((pricing?.modelRates ?? []).map((rate) => [`${rate.client}\0${rate.model}`, rate])), [pricing]);
  const [tip, setTip] = useState(null);
  if (!rows.length) return null;

  const tips = new Map();
  const onMove = (e) => {
    const key = e.target.closest?.('[data-tip]')?.dataset.tip;
    setTip(key ? { key, x: e.clientX, y: e.clientY } : null);
  };
  const body = rows.map((row) => {
    tips.set(row.id, { name: `${agentLabel(row.client)} · ${row.model}`, row, rate: commonRate(row, rates), mono: true });
    return (
      <tr key={row.id} className="agent-row is-flat-model" data-tip={row.id}>
        <th scope="row" className="col-name">
          <span className="model-name is-flat" title={row.model}>
            <AgentDot id={row.client} />
            <span className="model-text">{row.model}</span>
          </span>
        </th>
        <Cells row={row} tx={tx} />
      </tr>
    );
  });
  const current = tip ? tips.get(tip.key) : null;

  return (
    <div className="agent-table-wrap">
      <table className="agent-table" onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
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
