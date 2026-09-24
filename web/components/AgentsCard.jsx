import { PartsLegend } from '@/components/RankList';
import Card from '@/components/Card';
import Segmented from '@/components/Segmented';
import AgentModelList from '@/components/AgentModelList';
import { periodLabel } from '@/lib/i18n';

export default function AgentsCard({ data, period, metric, onMetric, agentLabel, locale, tx, handleProps }) {
  const hasRows = Object.keys(data.clients ?? {}).length > 0;
  return (
    <Card
      handleProps={handleProps}
      title={tx('cardAgents')}
      subtitle={tx(metric === 'cost' ? 'subRankCost' : 'subAgentsTokens', { period: periodLabel(locale, period) })}
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
      {hasRows ? (
        <>
          <AgentModelList clients={data.clients} models={data.models} metric={metric} agentLabel={agentLabel} tx={tx} pricing={data.pricing} />
          {metric === 'tokens' ? <PartsLegend tx={tx} /> : null}
        </>
      ) : (
        <p className="card-empty">{tx('emptyPeriod')}</p>
      )}
    </Card>
  );
}
