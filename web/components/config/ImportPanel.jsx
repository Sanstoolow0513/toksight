'use client';
import { useEffect, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { fetchJson } from '@/lib/api';
import { parseBundleText } from '@/lib/transfer';
import ImportPlan from './ImportPlan';
import ImportResults from './ImportResults';
import TransferMessage from './TransferMessage';

// Import flow as a small state machine held in ONE state object:
//   idle → previewing → planned → applying → done
// (`busy` stays lifted in TransferPanel so the tab switch can lock too.)
// `sequence` is the race guard: every new input bumps it, so a stale
// preview response can never overwrite a newer one. RestorePanel drives the
// same panel with a backupId (auto-preview on mount) and resets it via
// key={chosen.sequence}.

export default function ImportPanel({ backupId, tx, busy, setBusy, onImported }) {
  const [state, setState] = useState({ phase: 'idle', text: '', plan: null, selected: new Set(), results: null, message: null });
  const input = useRef(null);
  const sequence = useRef(0);
  const patch = (next) => setState((current) => ({ ...current, ...next }));

  function clearPreview() {
    sequence.current++;
    setState((current) => ({ ...current, phase: 'idle', plan: null, selected: new Set(), results: null, message: null }));
  }

  async function previewRequest(request) {
    clearPreview();
    const current = sequence.current;
    patch({ phase: 'previewing' });
    setBusy(true);
    try {
      const data = await fetchJson('/api/config/import/preview', { method: 'POST', action: 'import-preview', body: request });
      if (current !== sequence.current) return;
      const writable = data.plan.filter((row) => row.action === 'write');
      patch({
        phase: 'planned',
        plan: { request, rows: data.plan },
        selected: new Set(writable.map((row) => row.id)),
        message: { kind: data.warnings?.length ? 'warn' : 'success', key: 'cfgXferPlanReady', vars: { n: writable.length }, warnings: data.warnings },
      });
    } catch (err) {
      if (current === sequence.current) patch({ phase: 'idle', message: { text: String(err.message || err) } });
    } finally { if (current === sequence.current) setBusy(false); }
  }

  function previewText(value) {
    clearPreview();
    try { return previewRequest({ bundle: parseBundleText(value) }); }
    catch (err) {
      patch({ message: { key: err instanceof SyntaxError ? 'cfgXferBadJson' : 'cfgXferBadBundle' } });
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
      if (file.size > 10 * 1024 * 1024) { patch({ message: { key: 'cfgBundleOversize' } }); setBusy(false); return; }
      const value = await file.text();
      patch({ text: value });
      await previewText(value);
    } catch (err) { patch({ message: { text: String(err.message || err) } }); setBusy(false); }
  }

  async function apply() {
    const { plan, selected, results } = state;
    if (!plan || !selected.size || busy || results) return;
    const rows = plan.rows.filter((row) => row.action === 'write' && selected.has(row.id));
    setBusy(true); patch({ phase: 'applying', message: null });
    try {
      const data = await fetchJson('/api/config/import', {
        method: 'POST', action: 'import',
        body: { ...plan.request, selected: rows.map((row) => row.id), expected: Object.fromEntries(rows.map((row) => [row.id, row.expected])) },
      });
      const written = data.results.filter((row) => row.status === 'written').length;
      const failed = data.results.filter((row) => row.status === 'failed').length;
      patch({
        phase: 'done',
        results: data.results,
        message: { kind: failed ? 'error' : 'success', key: failed ? 'cfgXferImportPartial' : 'cfgXferImportDone', vars: { written, failed }, warnings: data.warnings },
      });
      if (written) onImported?.();
    } catch (err) { patch({ phase: 'planned', message: { text: String(err.message || err) } }); }
    finally { setBusy(false); }
  }

  const { text, plan, selected, results, message } = state;
  return <div className="config-transfer-body">
    <p className="muted">{tx(backupId ? 'cfgRestoreSteps' : 'cfgImportSteps')}</p>
    {!backupId && <div className="config-xfer-import-input">
      <textarea aria-label={tx('cfgXferPasteHint')} value={text} rows={4} spellCheck={false} disabled={busy}
        onChange={(event) => { patch({ text: event.target.value }); clearPreview(); }} placeholder={tx('cfgXferPasteHint')} />
      <div className="config-xfer-actions">
        <button className="btn" type="button" disabled={busy} onClick={() => input.current?.click()}><FileUp size={14} strokeWidth={1.5} aria-hidden="true" />{tx('cfgXferPickFile')}</button>
        <button className="btn" type="button" disabled={busy || !text.trim()} onClick={() => previewText(text)}>{tx('cfgDiffPreview')}</button>
        <button className="btn" type="button" disabled={busy || !text} onClick={() => { patch({ text: '' }); clearPreview(); }}>{tx('cfgXferReset')}</button>
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={pickFile} />
      </div>
    </div>}
    {backupId && <button className="btn" type="button" disabled={busy} onClick={() => previewRequest({ backupId })}>{tx('cfgDiffPreview')}</button>}
    {busy && <p className="muted" role="status">{tx('cfgXferWorking')}</p>}
    <TransferMessage message={message} tx={tx} />
    {plan && <ImportPlan plan={plan.rows} selected={selected} busy={busy || Boolean(results)} tx={tx} onToggle={(id) => {
      setState((current) => { const next = new Set(current.selected); if (next.has(id)) next.delete(id); else next.add(id); return { ...current, selected: next }; });
    }} />}
    {plan && selected.size > 0 && <div className="config-xfer-actions">
      <button className="btn btn-primary" type="button" disabled={busy || Boolean(results)} onClick={apply}>{tx(backupId ? 'cfgRestoreApply' : 'cfgXferExec', { n: selected.size })}</button>
      <span className="muted">{tx('cfgApplyBackupNote')}</span>
    </div>}
    <ImportResults results={results} tx={tx} />
  </div>;
}
