'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import TransferPanel from '@/components/TransferPanel';
import AgentCard from '@/components/config/AgentCard';
import Shell from '@/components/Shell';
import { fetchJson } from '@/lib/api';
import { useLocale } from '@/lib/useLocale';

export default function ConfigPage() {
  const { locale, setLocale, tx } = useLocale('cfgDocTitle');
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInventory(await fetchJson('/api/config'));
      setError(null);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Shell
      active="config"
      frameClass="config-frame"
      tx={tx}
      locale={locale}
      setLocale={setLocale}
      meta={<span className="fetch-meta">{tx('cfgMeta')}</span>}
      actions={
        <button className="btn" type="button" onClick={load} disabled={loading}>
          <RefreshCw size={14} strokeWidth={1.5} className={loading ? 'icon-spin' : undefined} aria-hidden="true" />
          {loading ? tx('refreshing') : tx('refresh')}
        </button>
      }
    >
      <section className="config-hero">
        <span className="config-kicker">{tx('cfgKicker')}</span>
        <h2>{tx('cfgTitle')}</h2>
        <p>{tx('cfgIntro')}</p>
      </section>

      <div className="banner warn config-warning">
        <ShieldAlert size={15} strokeWidth={1.5} aria-hidden="true" />
        <div><b>{tx('cfgSecretTitle')}</b> {tx('cfgSecretBody')}</div>
      </div>

      {error && (
        <div className="banner error" role="alert">
          <TriangleAlert size={15} strokeWidth={1.5} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {inventory?.warnings?.map((warning, index) => (
        <div className="banner warn" key={`${warning}-${index}`}>
          <TriangleAlert size={15} strokeWidth={1.5} aria-hidden="true" />
          <span>{warning}</span>
        </div>
      ))}

      <div className="config-stack">
        {loading && !inventory ? (
          <div className="config-loading"><span className="skel" /><span className="skel" /><span className="skel" /></div>
        ) : inventory ? (
          inventory.agents.map((agent) => (
            <AgentCard agent={agent} key={agent.id} locale={locale} tx={tx} />
          ))
        ) : (
          <div className="config-empty">{tx('cfgLoadEmpty')}</div>
        )}
      </div>

      <TransferPanel agents={inventory?.agents} tx={tx} locale={locale} onImported={load} />

      <footer className="foot">
        <span>{tx('cfgFootScope')}</span>
        <span>{tx('cfgFootRedact')}</span>
        <span>{tx('cfgFootLocal')}</span>
      </footer>
    </Shell>
  );
}
