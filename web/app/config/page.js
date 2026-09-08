'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { DEFAULT_LOCALE, readStoredLocale, t, writeStoredLocale } from '@/lib/i18n';
import TransferPanel from '@/components/TransferPanel';

import AgentCard from '@/components/config/AgentCard';
import { responseJson } from '@/lib/config';

function LangSwitch({ locale, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      <button type="button" className={locale === 'zh-CN' ? 'on' : ''} onClick={() => onChange('zh-CN')}>
        中文
      </button>
      <button type="button" className={locale === 'en' ? 'on' : ''} onClick={() => onChange('en')}>
        EN
      </button>
    </div>
  );
}

export default function ConfigPage() {
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const tx = useCallback((key, vars) => t(locale, key, vars), [locale]);
  const setLocale = useCallback((next) => {
    setLocaleState(next);
    writeStoredLocale(next);
  }, []);

  useEffect(() => setLocaleState(readStoredLocale()), []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t(locale, 'cfgDocTitle');
  }, [locale]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await responseJson(await fetch('/api/config', { cache: 'no-store' }));
      setInventory(data);
      setError(null);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <main className="wrap">
      <div className="frame config-frame">
        <header className="masthead">
          <div className="brand">
            <h1 className="logo-chip">toksight</h1>
            <span className="fetch-meta">{tx('cfgMeta')}</span>
          </div>
          <div className="head-actions">
            <nav className="top-nav" aria-label={tx('navAria')}>
              <Link href="/">{tx('navDashboard')}</Link>
              <Link className="active" href="/config" aria-current="page">{tx('navConfig')}</Link>
            </nav>
            <LangSwitch locale={locale} onChange={setLocale} label={tx('langGroup')} />
            <button className="btn" type="button" onClick={load} disabled={loading}>
              <RefreshCw size={14} strokeWidth={2} className={loading ? 'icon-spin' : undefined} aria-hidden="true" />
              {loading ? tx('refreshing') : tx('refresh')}
            </button>
          </div>
        </header>

        <section className="config-hero">
          <span className="config-kicker">{tx('cfgKicker')}</span>
          <h2>{tx('cfgTitle')}</h2>
          <p>{tx('cfgIntro')}</p>
        </section>

        <div className="banner warn config-warning">
          <ShieldAlert size={15} strokeWidth={2} aria-hidden="true" />
          <div><b>{tx('cfgSecretTitle')}</b> {tx('cfgSecretBody')}</div>
        </div>

        {error && (
          <div className="banner error" role="alert">
            <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {inventory?.warnings?.map((warning, index) => (
          <div className="banner warn" key={`${warning}-${index}`}>
            <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
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
      </div>
    </main>
  );
}
