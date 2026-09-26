import Card from '@/components/Card';
import AgentTable from '@/components/AgentTable';
import { periodLabel } from '@/lib/i18n';

export default function AgentsCard({ data, period, sortBy, onSort, agentLabel, locale, tx, handleProps }) {
  const hasRows = Object.keys(data.clients ?? {}).length > 0;
  return (
    <Card
      handleProps={handleProps}
      title={tx('cardAgents')}
      subtitle={tx(sortBy === 'cost' ? 'subAgentsCost' : 'subAgentsTokens', { period: periodLabel(locale, period) })}
    >
      {hasRows ? (
        <AgentTable clients={data.clients} models={data.models} pricing={data.pricing} sortBy={sortBy} onSort={onSort} agentLabel={agentLabel} tx={tx} />
      ) : (
        <p className="card-empty">{tx('emptyPeriod')}</p>
      )}
    </Card>
  );
}
