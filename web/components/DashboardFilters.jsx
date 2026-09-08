'use client';
import { useState } from 'react';

const CLIENTS = [{ id: 'zcode', label: 'ZCode' }, { id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex CLI' }, { id: 'opencode', label: 'OpenCode' }, { id: 'kimi', label: 'Kimi Code' }];
export default function DashboardFilters({ query, view, tx, loading, onApply }) {
  const params = new URLSearchParams(query);
  const [period, setPeriod] = useState(params.get('period') || (params.has('since') || params.has('until') ? 'custom' : 'all'));
  const [client, setClient] = useState(params.get('client') || '');
  const [since, setSince] = useState(params.get('since') || view?.since || view?.today || '');
  const [until, setUntil] = useState(params.get('until') || view?.until || view?.today || '');
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
        setPeriod(event.target.value);
        if (!since) setSince(view?.since || view?.today || '');
        if (!until) setUntil(view?.until || view?.today || '');
      }}>
        {['all', 'today', '7d', '30d', 'month', 'custom'].map((id) => <option value={id} key={id}>{tx(`period_${id}`)}</option>)}
      </select></label>
      <label>{tx('thAgent')}<select aria-label={tx('thAgent')} value={client} onChange={(event) => setClient(event.target.value)}>
        <option value="">{tx('filterAllAgents')}</option>
        {client.includes(',') && <option value={client}>{client}</option>}
        {(view?.availableClients || CLIENTS).map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
      </select></label>
      {period === 'custom' && <>
        <label>{tx('filterStart')}<input aria-label={tx('filterStart')} type="date" value={since} max={until || undefined} required onChange={(event) => setSince(event.target.value)} /></label>
        <label>{tx('filterEnd')}<input aria-label={tx('filterEnd')} type="date" value={until} min={since || undefined} required onChange={(event) => setUntil(event.target.value)} /></label>
      </>}
      <button className="btn btn-primary" type="submit" disabled={loading}>{tx('filterApply')}</button>
      <button className="btn" type="button" onClick={() => onApply('')} disabled={loading}>{tx('filterReset')}</button>
    </div>
    <p className="muted">{tx('filterShared')}{restricted ? ` ${tx('filterStartup', { clients: view.startup.clients?.join(', ') || tx('filterAllAgents'), since: view.startup.since || '…', until: view.startup.until || '…' })}` : ''}</p>
  </form>;
}
