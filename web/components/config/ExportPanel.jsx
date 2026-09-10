'use client';
import { useMemo, useState } from 'react';
import { ClipboardCopy, Download } from 'lucide-react';
import { ITEM_KEYS } from '@/lib/config';
import { fetchJson } from '@/lib/api';
import { configFileGroups, exportFileIds, isExportable } from '@/lib/transfer';
import TransferMessage from './TransferMessage';

export default function ExportPanel({ agents, tx, busy, setBusy }) {
  const [excluded, setExcluded] = useState(() => new Set());
  const [message, setMessage] = useState(null);
  const groups = useMemo(() => configFileGroups(agents), [agents]);
  const ids = exportFileIds(groups, excluded);
  function toggle(fileIds) {
    setExcluded((previous) => {
      const next = new Set(previous);
      const allSelected = fileIds.every((id) => !previous.has(id));
      for (const id of fileIds) { if (allSelected) next.add(id); else next.delete(id); }
      return next;
    });
  }
  async function exportBundle(copy) {
    if (!ids.length || busy) return;
    setBusy(true); setMessage(null);
    try {
      const bundle = await fetchJson(`/api/config/export?files=${encodeURIComponent(ids.join(','))}`);
      const text = JSON.stringify(bundle, null, 2);
      if (copy) await navigator.clipboard.writeText(text);
      else {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = 'toksight-agent-configs.json';
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage({ kind: bundle.warnings?.length ? 'warn' : 'success', key: copy ? 'cfgXferCopied' : 'cfgXferExportDone',
        vars: { n: bundle.files.length }, warnings: bundle.warnings });
    } catch (err) { setMessage({ text: String(err.message || err) }); }
    finally { setBusy(false); }
  }
  return <div className="config-transfer-body">
    <p className="muted">{tx('cfgExportScope')}</p>
    <TransferMessage message={message} tx={tx} />
    <div className="config-xfer-files">
      {groups.map(({ agent, files }) => {
        const available = files.filter(isExportable);
        const selected = available.filter((file) => !excluded.has(file.id));
        return <div className="config-xfer-agent" key={agent.id}>
          <label className="config-xfer-agent-label">
            <input type="checkbox" checked={available.length > 0 && selected.length === available.length}
              ref={(input) => { if (input) input.indeterminate = selected.length > 0 && selected.length < available.length; }}
              disabled={busy || !available.length} onChange={() => toggle(available.map((file) => file.id))} />
            <b>{agent.label}</b><span>{tx('cfgXferFilesCount', { n: selected.length })}</span>
          </label>
          {files.map((file) => <label className="config-xfer-file" key={file.id}>
            <input type="checkbox" checked={isExportable(file) && !excluded.has(file.id)} disabled={busy || !isExportable(file)} onChange={() => toggle([file.id])} />
            <span className="config-xfer-file-name">{tx(ITEM_KEYS[file.id] || 'cfgItemFallback')} · {file.fileName}</span>
            {!isExportable(file) && <span className="tag">{tx(!file.exists ? 'cfgMissing' : file.error ? 'cfgUnreadable' : 'cfgSkipOversize')}</span>}
          </label>)}
        </div>;
      })}
    </div>
    <div className="config-xfer-actions">
      <button className="btn" type="button" disabled={busy || !ids.length} onClick={() => exportBundle(false)}><Download size={14} strokeWidth={1.5} aria-hidden="true" />{tx('cfgXferDownload')}</button>
      <button className="btn" type="button" disabled={busy || !ids.length} onClick={() => exportBundle(true)}><ClipboardCopy size={14} strokeWidth={1.5} aria-hidden="true" />{tx('cfgXferCopy')}</button>
      <span className="muted">{tx('cfgXferFilesCount', { n: ids.length })}</span>
    </div>
  </div>;
}
