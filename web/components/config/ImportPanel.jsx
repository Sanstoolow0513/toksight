'use client';
import { useEffect, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { responseJson } from '@/lib/config';
import { parseBundleText } from '@/lib/transfer';
import ImportPlan from './ImportPlan';
import ImportResults from './ImportResults';
import TransferMessage from './TransferMessage';

export default function ImportPanel({ backupId, tx, busy, setBusy, onImported }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [results, setResults] = useState(null);
  const [message, setMessage] = useState(null);
  const input = useRef(null);
  const sequence = useRef(0);

  function clearPreview() {
    sequence.current++;
    setPreview(null); setSelected(new Set()); setResults(null); setMessage(null);
  }

  async function previewRequest(request) {
    clearPreview();
    const current = sequence.current;
    setBusy(true);
    try {
      const data = await responseJson(await fetch('/api/config/import/preview', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-toksight-action': 'import-preview' },
        body: JSON.stringify(request),
      }));
      if (current !== sequence.current) return;
      setPreview({ request, plan: data.plan });
      const writable = data.plan.filter((row) => row.action === 'write');
      setSelected(new Set(writable.map((row) => row.id)));
      setMessage({ kind: data.warnings?.length ? 'warn' : 'success', key: 'cfgXferPlanReady', vars: { n: writable.length }, warnings: data.warnings });
    } catch (err) {
      if (current === sequence.current) setMessage({ text: String(err.message || err) });
    } finally { if (current === sequence.current) setBusy(false); }
  }

  function previewText(value) {
    clearPreview();
    try { return previewRequest({ bundle: parseBundleText(value) }); }
    catch (err) {
      setMessage({ key: err instanceof SyntaxError ? 'cfgXferBadJson' : 'cfgXferBadBundle' });
      setBusy(false);
    }
  }

  useEffect(() => {
    if (backupId) void previewRequest({ backupId });
    return () => { sequence.current++; };
  }, [backupId]);

  async function pickFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    clearPreview(); setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) { setMessage({ key: 'cfgBundleOversize' }); setBusy(false); return; }
      const value = await file.text();
      setText(value);
      await previewText(value);
    } catch (err) { setMessage({ text: String(err.message || err) }); setBusy(false); }
  }

  async function apply() {
    if (!preview || !selected.size || busy || results) return;
    const rows = preview.plan.filter((row) => row.action === 'write' && selected.has(row.id));
    setBusy(true); setMessage(null);
    try {
      const data = await responseJson(await fetch('/api/config/import', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-toksight-action': 'import' },
        body: JSON.stringify({ ...preview.request, selected: rows.map((row) => row.id), expected: Object.fromEntries(rows.map((row) => [row.id, row.expected])) }),
      }));
      setResults(data.results);
      const written = data.results.filter((row) => row.status === 'written').length;
      const failed = data.results.filter((row) => row.status === 'failed').length;
      setMessage({ kind: failed ? 'error' : 'success', key: failed ? 'cfgXferImportPartial' : 'cfgXferImportDone', vars: { written, failed }, warnings: data.warnings });
      if (written) onImported?.();
    } catch (err) { setMessage({ text: String(err.message || err) }); }
    finally { setBusy(false); }
  }

  return <div className="config-transfer-body">
    <p className="muted">{tx(backupId ? 'cfgRestoreSteps' : 'cfgImportSteps')}</p>
    {!backupId && <div className="config-xfer-import-input">
      <textarea aria-label={tx('cfgXferPasteHint')} value={text} rows={4} spellCheck={false} disabled={busy}
        onChange={(event) => { setText(event.target.value); clearPreview(); }} placeholder={tx('cfgXferPasteHint')} />
      <div className="config-xfer-actions">
        <button className="btn" type="button" disabled={busy} onClick={() => input.current?.click()}><FileUp size={14} aria-hidden="true" />{tx('cfgXferPickFile')}</button>
        <button className="btn" type="button" disabled={busy || !text.trim()} onClick={() => previewText(text)}>{tx('cfgDiffPreview')}</button>
        <button className="btn" type="button" disabled={busy || !text} onClick={() => { setText(''); clearPreview(); }}>{tx('cfgXferReset')}</button>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={pickFile} />
      </div>
    </div>}
    {backupId && <button className="btn" type="button" disabled={busy} onClick={() => previewRequest({ backupId })}>{tx('cfgDiffPreview')}</button>}
    {busy && <p className="muted" role="status">{tx('cfgXferWorking')}</p>}
    <TransferMessage message={message} tx={tx} />
    {preview && <ImportPlan plan={preview.plan} selected={selected} busy={busy || Boolean(results)} tx={tx} onToggle={(id) => {
      setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    }} />}
    {preview && selected.size > 0 && <div className="config-xfer-actions">
      <button className="btn btn-primary" type="button" disabled={busy || Boolean(results)} onClick={apply}>{tx(backupId ? 'cfgRestoreApply' : 'cfgXferExec', { n: selected.size })}</button>
      <span className="muted">{tx('cfgApplyBackupNote')}</span>
    </div>}
    <ImportResults results={results} tx={tx} />
  </div>;
}
