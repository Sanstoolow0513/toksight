import { useMemo } from 'react';
import Card from '@/components/Card';
import Segmented from '@/components/Segmented';
import { PartsLegend, RankRow } from '@/components/RankList';
import { agentRows } from '@/lib/report';
import { periodLabel } from '@/lib/i18n';

export default function AgentsCard({ data, period, metric, onMetric, agentLabel, locale, tx, index, handleProps }) {
  const rows = useMemo(() => agentRows(data.clients, metric), [data.clients, metric]);
  return (
    <Card
      index={index}
      handleProps={handleProps}
      title={tx('cardAgents')}
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
            {rows.map((row) => (
              <RankRow key={row.id} name={agentLabel(row.id)} row={row} metric={metric} tx={tx} />
            ))}
          </ol>
          {metric === 'tokens' ? <PartsLegend tx={tx} /> : null}
        </>
      ) : (
        <p className="card-empty">{tx('emptyPeriod')}</p>
      )}
    </Card>
  );
}
