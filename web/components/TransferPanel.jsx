'use client';
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import ExportPanel from './config/ExportPanel';
import ImportPanel from './config/ImportPanel';
import RestorePanel from './config/RestorePanel';

export default function TransferPanel({ agents, tx, locale, onImported }) {
  const [tab, setTab] = useState('export');
  const [busy, setBusy] = useState(false);
  const props = { tx, busy, setBusy, onImported };
  return <section className="config-transfer">
    <div className="config-transfer-head">
      <div><span className="config-kicker">{tx('cfgXferKicker')}</span><h2>{tx('cfgXferTitle')}</h2><p>{tx('cfgXferIntro')}</p></div>
      <div className="seg" role="group" aria-label={tx('cfgXferTabs')}>
        {['export', 'import', 'restore'].map((value) => <button key={value} type="button" className={tab === value ? 'on' : ''} aria-pressed={tab === value} disabled={busy} onClick={() => setTab(value)}>
          {tx(value === 'export' ? 'cfgXferTabExport' : value === 'import' ? 'cfgXferTabImport' : 'cfgRestoreTab')}
        </button>)}
      </div>
    </div>
    <div className="banner warn config-warning"><ShieldAlert size={15} strokeWidth={1.5} aria-hidden="true" /><div>{tx('cfgXferSecretNote')}</div></div>
    {tab === 'export' ? <ExportPanel agents={agents} {...props} /> : tab === 'import' ? <ImportPanel {...props} /> : <RestorePanel locale={locale} {...props} />}
  </section>;
}
