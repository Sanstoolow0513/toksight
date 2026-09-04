'use client';

// Configuration bundle export / import panel for the /config page.
// Export: pick allowlisted config files → download (or copy) a single JSON
//   bundle containing their UNREDACTED contents (a migration needs the real
//   values; credential files are excluded server-side, always).
// Import: paste or pick a bundle → server-side preview (what would be
//   written, what would be backed up) → confirm → apply. Existing files are
//   backed up before replacement; the backup paths are reported back.

import { useMemo, useRef, useState } from 'react';
import { ClipboardCopy, Download, FileUp, ShieldAlert, TriangleAlert } from 'lucide-react';

const REASON_KEYS = {
  secret: 'cfgSkipSecret',
  'unknown-id': 'cfgSkipUnknown',
  malformed: 'cfgSkipMalformed',
  'no-content': 'cfgSkipNoContent',
  oversize: 'cfgSkipOversize',
  'target-not-file': 'cfgSkipTargetNotFile',
  'not-selected': 'cfgSkipNotSelected',
};

async function responseJson(res) {
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

// Config files only, and only healthy ones: credential entries (kind
// 'secret') never join the checklist regardless of their state, and an entry
// in an error state cannot be bundled anyway (the server would skip it with
// a warning). The server also refuses to bundle credentials, so this only
// shapes the UI.
function configFileGroups(agents) {
  return (agents || []).map((agent) => ({
    agent,
    files: (agent.files || []).filter((file) => file.kind === 'config' && !file.error),
  }));
}

// Server-side skip warnings (oversize/unreadable/not-a-regular-file files on
// export, duplicate bundle entries on preview/apply) ride along the JSON
// response — attach them to the success banner instead of dropping them.
function bannerWithWarnings(tx, base, warnings) {
  if (!warnings?.length) return base;
  return {
    kind: base.kind === 'ok' ? 'warn' : base.kind,
    text: `${base.text}${tx('cfgXferWarnSuffix', { n: warnings.length, list: warnings.join(' ; ') })}`,
  };
}

// Parses bundle text into { parsed } or { error: 'bad-json' | 'bad-bundle' }.
// One parser, two callers: validateBundleText (validation-only messages) and
// previewImport (the parse whose result is previewed and later written).
function parseBundleText(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { parsed };
    return { error: 'bad-bundle' };
  } catch {
    return { error: 'bad-json' };
  }
}

export default function TransferPanel({ agents, tx, onImported }) {
  const [tab, setTab] = useState('export');
  const [message, setMessage] = useState(null); // { kind: 'ok' | 'warn' | 'error', text }
  const [busy, setBusy] = useState(false);

  // --- export ---
  const groups = useMemo(() => configFileGroups(agents), [agents]);
  const [excluded, setExcluded] = useState(() => new Set());
  const exportIds = useMemo(
    () => groups.flatMap((group) => group.files.filter((file) => !excluded.has(file.id)).map((file) => file.id)),
    [groups, excluded],
  );

  function toggleExportFile(id) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExportAgent(agentId) {
    const agentIds = groups.find((group) => group.agent.id === agentId)?.files.map((file) => file.id) || [];
    const allExcluded = agentIds.every((id) => excluded.has(id));
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const id of agentIds) {
        if (allExcluded) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function fetchExport() {
    const query = exportIds.length ? `?files=${encodeURIComponent(exportIds.join(','))}` : '';
    return responseJson(await fetch(`/api/config/export${query}`, { cache: 'no-store' }));
  }

  async function downloadBundle() {
    if (!exportIds.length) {
      setMessage({ kind: 'warn', text: tx('cfgXferNoFiles') });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const bundle = await fetchExport();
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'toksight-agent-configs.json';
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(bannerWithWarnings(
        tx,
        { kind: 'ok', text: tx('cfgXferExportDone', { n: bundle.files?.length ?? 0 }) },
        bundle.warnings,
      ));
    } catch (err) {
      setMessage({ kind: 'error', text: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  }

  async function copyBundle() {
    if (!exportIds.length) {
      setMessage({ kind: 'warn', text: tx('cfgXferNoFiles') });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const bundle = await fetchExport();
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      setMessage(bannerWithWarnings(
        tx,
        { kind: 'ok', text: tx('cfgXferCopied', { n: bundle.files?.length ?? 0 }) },
        bundle.warnings,
      ));
    } catch (err) {
      setMessage({ kind: 'error', text: err?.message?.includes('clipboard') ? tx('cfgXferCopyFail') : String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  }

  // --- import ---
  // Single source of truth for a previewed import: the exact text the bundle
  // was parsed from (`text`), the parsed bundle that was sent to the server
  // (`bundle`) and the plan the server returned for it (`plan`). The plan
  // never exists apart from the bundle it was computed from, and any textarea
  // edit that diverges from `text` drops the whole preview — so preview/apply
  // structurally cannot act on a snapshot that no longer matches the screen.
  const [bundleText, setBundleText] = useState('');
  const [preview, setPreview] = useState(null); // { text, bundle, plan } | null
  const [selected, setSelected] = useState(() => new Set());
  const [results, setResults] = useState(null);
  const fileInput = useRef(null);
  const plan = preview?.plan ?? null;

  // Every text change funnels through here: keep the text, and as soon as it
  // diverges from the preview's snapshot, drop the preview and everything
  // derived from it (selected rows, apply results).
  function setImportText(text) {
    setBundleText(text);
    if (preview && text !== preview.text) {
      setPreview(null);
      setSelected(new Set());
      setResults(null);
    }
  }

  function resetImport() {
    setBundleText('');
    setPreview(null);
    setSelected(new Set());
    setResults(null);
  }

  // Parse-button / file-pick / blur path: validation only. It checks the text
  // and reports the outcome; the bundle an import later executes always comes
  // from previewImport's own parse of the current text (what you previewed is
  // what you write), so this path stores nothing.
  function validateBundleText(text, label) {
    setImportText(text);
    const { parsed, error } = parseBundleText(text);
    if (error) {
      setMessage({ kind: 'error', text: tx(error === 'bad-json' ? 'cfgXferBadJson' : 'cfgXferBadBundle') });
      return;
    }
    setMessage(label ? { kind: 'ok', text: tx('cfgXferLoaded', { name: label, n: parsed.files?.length ?? 0 }) } : null);
  }

  async function onPickFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      validateBundleText(await file.text(), file.name);
    } catch (err) {
      setMessage({ kind: 'error', text: String(err?.message || err) });
    }
  }

  function toggleImportFile(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function previewImport() {
    const text = bundleText;
    if (!text.trim()) {
      setMessage({ kind: 'error', text: tx('cfgXferNoBundle') });
      return;
    }
    // Parse the CURRENT text unconditionally: what gets previewed is exactly
    // what is on screen, and the same parse result is what runImport later
    // writes — there is no stored parse that could have gone stale.
    const { parsed, error } = parseBundleText(text);
    if (error) {
      setMessage({ kind: 'error', text: tx(error === 'bad-json' ? 'cfgXferBadJson' : 'cfgXferBadBundle') });
      return;
    }
    setBusy(true);
    setMessage(null);
    setResults(null);
    try {
      const data = await responseJson(await fetch('/api/config/import/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-toksight-action': 'import-preview' },
        body: JSON.stringify({ bundle: parsed }),
      }));
      if (data.error) {
        setMessage({ kind: 'error', text: data.error });
        return;
      }
      setPreview({ text, bundle: parsed, plan: data.plan });
      setSelected(new Set(data.plan.filter((row) => row.action === 'write').map((row) => row.id)));
      const writable = data.plan.filter((row) => row.action === 'write').length;
      setMessage(bannerWithWarnings(
        tx,
        writable
          ? { kind: 'ok', text: tx('cfgXferPlanReady', { n: writable }) }
          : { kind: 'warn', text: tx('cfgXferNoWrite') },
        data.warnings,
      ));
    } catch (err) {
      setMessage({ kind: 'error', text: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!preview) {
      setMessage({ kind: 'warn', text: tx('cfgXferNoBundle') });
      return;
    }
    const { bundle, plan: rows } = preview;
    const ids = rows.filter((row) => row.action === 'write' && selected.has(row.id)).map((row) => row.id);
    if (!ids.length) {
      setMessage({ kind: 'warn', text: tx('cfgXferNoWrite') });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const data = await responseJson(await fetch('/api/config/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-toksight-action': 'import' },
        body: JSON.stringify({ bundle, selected: ids }),
      }));
      if (data.error) {
        setMessage({ kind: 'error', text: data.error });
        return;
      }
      setResults(data.results);
      const failed = data.results.filter((row) => row.status === 'failed').length;
      const written = data.results.filter((row) => row.status === 'written').length;
      setMessage(bannerWithWarnings(
        tx,
        failed
          ? { kind: 'error', text: tx('cfgXferImportPartial', { written, failed }) }
          : { kind: 'ok', text: tx('cfgXferImportDone', { written }) },
        data.warnings,
      ));
      if (written > 0) onImported?.();
    } catch (err) {
      setMessage({ kind: 'error', text: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  }

  const planWriteRows = plan?.filter((row) => row.action === 'write') || [];

  return (
    <section className="config-transfer">
      <div className="config-transfer-head">
        <div>
          <span className="config-kicker">{tx('cfgXferKicker')}</span>
          <h2>{tx('cfgXferTitle')}</h2>
          <p>{tx('cfgXferIntro')}</p>
        </div>
        <div className="seg" role="group" aria-label={tx('cfgXferTabs')}>
          <button type="button" className={tab === 'export' ? 'on' : ''} onClick={() => { setTab('export'); setMessage(null); }}>
            {tx('cfgXferTabExport')}
          </button>
          <button type="button" className={tab === 'import' ? 'on' : ''} onClick={() => { setTab('import'); setMessage(null); }}>
            {tx('cfgXferTabImport')}
          </button>
        </div>
      </div>

      <div className="banner warn config-warning">
        <ShieldAlert size={15} strokeWidth={2} aria-hidden="true" />
        <div>{tx('cfgXferSecretNote')}</div>
      </div>

      {message && (
        <div className={`banner ${message.kind === 'ok' ? 'success' : message.kind === 'warn' ? 'warn' : 'error'}`} role="status">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
          <span>{message.text}</span>
        </div>
      )}

      {tab === 'export' ? (
        <div className="config-transfer-body">
          <div className="config-xfer-files">
            {groups.map(({ agent, files }) => (
              <div className="config-xfer-agent" key={agent.id}>
                <label className="config-xfer-agent-label">
                  <input
                    type="checkbox"
                    checked={!files.some((file) => excluded.has(file.id))}
                    onChange={() => toggleExportAgent(agent.id)}
                  />
                  <b>{agent.label}</b>
                  <span>{tx('cfgXferFilesCount', { n: files.filter((file) => !excluded.has(file.id)).length })}</span>
                </label>
                {files.map((file) => (
                  <label className="config-xfer-file" key={file.id}>
                    <input
                      type="checkbox"
                      checked={!excluded.has(file.id)}
                      onChange={() => toggleExportFile(file.id)}
                      disabled={!file.exists}
                    />
                    <span className="config-xfer-file-name">{file.fileName}</span>
                    {!file.exists && <span className="tag">{tx('cfgMissing')}</span>}
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div className="config-xfer-actions">
            <button className="btn" type="button" onClick={downloadBundle} disabled={busy}>
              <Download size={14} strokeWidth={2} aria-hidden="true" />
              {busy ? tx('cfgXferWorking') : tx('cfgXferDownload')}
            </button>
            <button className="btn" type="button" onClick={copyBundle} disabled={busy}>
              <ClipboardCopy size={14} strokeWidth={2} aria-hidden="true" />
              {tx('cfgXferCopy')}
            </button>
          </div>
        </div>
      ) : (
        <div className="config-transfer-body">
          <div className="config-xfer-import-input">
            <textarea
              value={bundleText}
              onChange={(event) => setImportText(event.target.value)}
              onBlur={() => bundleText && !preview && validateBundleText(bundleText)}
              placeholder={tx('cfgXferPasteHint')}
              rows={4}
              spellCheck={false}
              disabled={busy}
            />
            <div className="config-xfer-actions">
              <button className="btn" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
                <FileUp size={14} strokeWidth={2} aria-hidden="true" />
                {tx('cfgXferPickFile')}
              </button>
              <button className="btn" type="button" onClick={() => validateBundleText(bundleText)} disabled={busy || !bundleText.trim()}>
                {tx('cfgXferParse')}
              </button>
              <button className="btn" type="button" onClick={previewImport} disabled={busy || !bundleText.trim()}>
                {tx('cfgXferPreview')}
              </button>
              <input ref={fileInput} type="file" accept=".json,application/json" onChange={onPickFile} hidden />
            </div>
          </div>

          {plan && (
            <div className="config-table-wrap">
              <table className="config-table">
                <thead>
                  <tr>
                    <th />
                    <th>{tx('cfgXferColAgent')}</th>
                    <th>{tx('cfgXferColFile')}</th>
                    <th>{tx('cfgXferColTarget')}</th>
                    <th>{tx('cfgXferColAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.action === 'write' ? (
                          <input
                            type="checkbox"
                            checked={selected.has(row.id)}
                            onChange={() => toggleImportFile(row.id)}
                          />
                        ) : null}
                      </td>
                      <td>{row.agentId || '—'}</td>
                      <td title={row.fileName || row.id}>{row.fileName || row.id}</td>
                      <td title={row.targetPath || ''}>{row.targetPath || '—'}</td>
                      <td>
                        {row.action === 'write'
                          ? row.existing
                            ? <span className="tag tag-warn">{tx('cfgXferActionReplace')}</span>
                            : <span className="tag tag-ok">{tx('cfgXferActionNew')}</span>
                          : <span className="tag" title={tx(REASON_KEYS[row.reason] || 'cfgXferActionSkip')}>{tx('cfgXferActionSkip')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {planWriteRows.length > 0 && (
            <div className="config-xfer-actions">
              <button className="btn btn-primary" type="button" onClick={runImport} disabled={busy}>
                {busy ? tx('cfgXferWorking') : tx('cfgXferExec', { n: planWriteRows.filter((row) => selected.has(row.id)).length })}
              </button>
            </div>
          )}

          {results && (
            <div className="config-xfer-results">
              <b>{tx('cfgXferResultTitle')}</b>
              <ul>
                {results.map((row) => (
                  <li key={row.id}>
                    <span>{row.id}</span>
                    {row.status === 'written' && <span className="tag tag-ok">{tx('cfgXferWritten')}</span>}
                    {row.status === 'skipped' && <span className="tag">{tx(REASON_KEYS[row.reason] || 'cfgXferSkipped')}</span>}
                    {row.status === 'failed' && <span className="tag tag-error" title={row.error || ''}>{tx('cfgXferFailed')}</span>}
                    {row.backupPath && <code title={row.backupPath}>{tx('cfgXferBackupAt')} {row.backupPath}</code>}
                    {row.status === 'failed' && row.error && <code>{row.error}</code>}
                  </li>
                ))}
              </ul>
              <div className="config-xfer-actions">
                <button className="btn" type="button" onClick={resetImport} disabled={busy}>{tx('cfgXferReset')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
