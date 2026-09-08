'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { responseJson, formatBytes, formatDate } from '@/lib/config';
import ImportPanel from './ImportPanel';
import TransferMessage from './TransferMessage';

export default function RestorePanel({ tx, locale, busy, setBusy, onImported }) {
  const [inventory, setInventory] = useState(null);
  const [message, setMessage] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setMessage(null);
    try { setInventory(await responseJson(await fetch('/api/config/backups', { cache: 'no-store' }))); }
    catch (err) { setMessage({ text: String(err.message || err) }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  return <div className="config-transfer-body">
    <p className="muted">{tx('cfgRestoreIntro')}</p>
    <div className="config-xfer-actions"><button className="btn" type="button" onClick={load} disabled={loading || busy}><RefreshCw size={14} aria-hidden="true" />{tx('refresh')}</button></div>
    <TransferMessage message={message} tx={tx} />
    {inventory?.warnings?.map((text) => <TransferMessage key={text} message={{ kind: 'warn', text }} tx={tx} />)}
    {loading && <p className="muted" role="status">{tx('cfgXferWorking')}</p>}
    {inventory?.backups.length === 0 && <p className="muted">{tx('cfgRestoreEmpty')}</p>}
    {inventory?.backups.length > 0 && <div className="config-table-wrap"><table className="config-table">
      <thead><tr><th>{tx('cfgXferColAgent')}</th><th>{tx('cfgXferColFile')}</th><th>{tx('cfgBackupCreated')}</th><th>{tx('cfgSize')}</th><th>{tx('cfgXferColAction')}</th></tr></thead>
      <tbody>{inventory.backups.map((backup) => <tr key={backup.backupId}>
        <td>{backup.agentId}</td><td title={backup.path}>{backup.fileId}</td>
        <td>{formatDate(backup.createdAt, locale)}</td><td>{formatBytes(backup.size, locale)}</td>
        <td><button className="btn" type="button" disabled={busy} onClick={() => setChosen({ ...backup, sequence: (chosen?.sequence || 0) + 1 })}>{tx('cfgRestorePreview')}</button></td>
      </tr>)}</tbody>
    </table></div>}
    {chosen && <div className="config-restore-review">
      <p className="config-plan-path">{tx('cfgRestoreSource')}: <code>{chosen.path}</code></p>
      <ImportPanel key={chosen.sequence} backupId={chosen.backupId} tx={tx} busy={busy} setBusy={setBusy} onImported={() => { onImported?.(); void load(); }} />
    </div>}
  </div>;
}
