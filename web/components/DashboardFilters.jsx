'use client';
import { useEffect, useState } from 'react';
import { CLIENTS } from '@/lib/clients';

// Filter bar with draft state: edits stay local until 应用筛选. Drafts are
// re-synced from the applied `query` prop whenever it changes (the parent's
// old key={query} remount hack is gone). `view` is intentionally read only at
// sync time, not tracked as a dep — data refreshes must not clobber the
// user's in-progress edits.

function readDraft(query, view) {
  const params = new URLSearchParams(query);
  return {
    period: params.get('period') || (params.has('since') || params.has('until') ? 'custom' : 'all'),
    client: params.get('client') || '',
    since: params.get('since') || view?.since || view?.today || '',
    until: params.get('until') || view?.until || view?.today || '',
  };
}

export default function DashboardFilters({ query, view, tx, loading, onApply }) {
  const [draft, setDraft] = useState(() => readDraft(query, view));
  useEffect(() => setDraft(readDraft(query, view)), [query]);
  const { period, client, since, until } = draft;
  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const restricted = view?.startup?.clients?.length || view?.startup?.since || view?.startup?.until;
  return <form className="dashboard-filters" onSubmit={(event) => {
    event.preventDefault();
    const next = new URLSearchParams();
    if (period !== 'all') next.set('period', period);
    if (client) next.set('client', client);
    if (period === 'custom') { next.set('since', since); next.set('until', until); }
    onApply(next.toString());
  }}>
    <div className="filter-fields">
      <label>{tx('filterPeriod')}<select aria-label={tx('filterPeriod')} value={period} onChange={(event) => {
        patch({
          period: event.target.value,
          since: since || view?.since || view?.today || '',
          until: until || view?.until || view?.today || '',
        });
      }}>
        {['all', 'today', '7d', '30d', 'month', 'custom'].map((id) => <option value={id} key={id}>{tx(`period_${id}`)}</option>)}
      </select></label>
      <label>{tx('thAgent')}<select aria-label={tx('thAgent')} value={client} onChange={(event) => patch({ client: event.target.value })}>
        <option value="">{tx('filterAllAgents')}</option>
        {client.includes(',') && <option value={client}>{client}</option>}
        {(view?.availableClients || CLIENTS).map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
      </select></label>
      {period === 'custom' && <>
        <label>{tx('filterStart')}<input aria-label={tx('filterStart')} type="date" value={since} max={until || undefined} required onChange={(event) => patch({ since: event.target.value })} /></label>
        <label>{tx('filterEnd')}<input aria-label={tx('filterEnd')} type="date" value={until} min={since || undefined} required onChange={(event) => patch({ until: event.target.value })} /></label>
      </>}
      <button className="btn btn-primary" type="submit" disabled={loading}>{tx('filterApply')}</button>
      <button className="btn" type="button" onClick={() => onApply('')} disabled={loading}>{tx('filterReset')}</button>
    </div>
    <p className="muted">{tx('filterShared')}{restricted ? ` ${tx('filterStartup', { clients: view.startup.clients?.join(', ') || tx('filterAllAgents'), since: view.startup.since || '…', until: view.startup.until || '…' })}` : ''}</p>
  </form>;
}
