import { useMemo } from 'react';
import { RankRow } from '@/components/RankList';
import { agentRows, modelsByAgent } from '@/lib/report';
import { fmtCost } from '@/lib/format';

const RATE_PARTS = ['input', 'cacheRead', 'cacheWrite', 'output'];

function commonRate(row, rates) {
  const variants = row.modelIds?.length ? row.modelIds : [row.model];
  const found = variants.map((id) => rates.get(`${row.client}\0${id}`));
  const first = found[0];
  return first?.source && found.every((rate) => rate?.source === first.source && RATE_PARTS.every((part) => rate[part] === first[part])) ? first : null;
}

// Agent rows follow `metric`. Each agent's models stay ranked by cost — the
// former models card, nested here — with shares of the whole period.
export default function AgentModelList({ clients, models, metric, agentLabel, tx, pricing }) {
  const agents = useMemo(() => agentRows(clients, metric), [clients, metric]);
  const grouped = useMemo(() => modelsByAgent(models, 'cost'), [models]);
  const rates = useMemo(() => new Map((pricing?.modelRates ?? []).map((rate) => [`${rate.client}\0${rate.model}`, rate])), [pricing]);
  if (!agents.length) return null;
  return (
    <ol className="rank-list">
      {agents.map((agent) => {
        const group = grouped.get(agent.id);
        const rows = group?.rows ?? [];
        const others = group?.others;
        return (
          <li key={agent.id} className="agent-block">
            <RankRow as="div" name={agentLabel(agent.id)} row={agent} metric={metric} tx={tx} />
            {rows.length || others ? (
              <ol className="rank-list model-list" aria-label={tx('cardModels')}>
                {rows.map((row, i) => {
                  const rate = commonRate(row, rates);
                  return (
                    <RankRow
                      key={row.id}
                      rank={i + 1}
                      name={row.model}
                      mono
                      extra={rate ? tx('rowRates', {
                        source: rate.source, input: fmtCost(rate.input), read: fmtCost(rate.cacheRead),
                        write: fmtCost(rate.cacheWrite), output: fmtCost(rate.output),
                      }) : null}
                      row={row}
                      metric="cost"
                      tx={tx}
                    />
                  );
                })}
                {others ? (
                  <RankRow key="__others__" rank="…" name={tx('others', { n: others.count })} row={others} metric="cost" tx={tx} muted />
                ) : null}
              </ol>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
