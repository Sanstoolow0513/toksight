import { useMemo } from 'react';
import Card from '@/components/Card';
import Segmented from '@/components/Segmented';
import { PartsLegend, RankRow } from '@/components/RankList';
import { modelRows } from '@/lib/report';
import { periodLabel } from '@/lib/i18n';
import { fmtCost } from '@/lib/format';

export default function ModelsCard({ data, period, metric, onMetric, agentLabel, locale, tx, index, handleProps }) {
  const { rows, others } = useMemo(() => modelRows(data.models, metric), [data.models, metric]);
  const rates = useMemo(() => new Map((data.pricing?.modelRates ?? []).map((rate) => [`${rate.client}\0${rate.model}`, rate])), [data.pricing]);
  return (
    <Card
      index={index}
      handleProps={handleProps}
      title={tx('cardModels')}
      subtitle={tx(metric === 'cost' ? 'subRankCost' : 'subRankTokens', { period: periodLabel(locale, period) })}
      actions={
        <Segmented
          compact
          label={tx('metricGroup')}
          value={metric}
          onChange={onMetric}
          options={[{ value: 'tokens', label: tx('metricTokens') }, { value: 'cost', label: tx('metricCost') }]}
        />
      }
    >
      {rows.length ? (
        <>
          <ol className="rank-list">
            {rows.map((row, i) => (
              <RankRow
                key={row.id}
                rank={i + 1}
                name={row.model}
                mono
                lead={tx('rowAgents', { agents: row.clients.map(agentLabel).join(', ') })}
                extra={row.clients.length === 1 && (() => {
                  const rate = rates.get(`${row.clients[0]}\0${row.model}`);
                  return rate?.source ? tx('rowRates', { source: rate.source, input: fmtCost(rate.input), read: fmtCost(rate.cacheRead),
                    write: fmtCost(rate.cacheWrite), output: fmtCost(rate.output) }) : null;
                })()}
                row={row}
                metric={metric}
                tx={tx}
              />
            ))}
            {others ? (
              <RankRow rank="…" name={tx('others', { n: others.count })} row={others} metric={metric} tx={tx} muted />
            ) : null}
          </ol>
          {metric === 'tokens' ? <PartsLegend tx={tx} /> : null}
        </>
      ) : (
        <p className="card-empty">{tx('emptyPeriod')}</p>
      )}
    </Card>
  );
}
