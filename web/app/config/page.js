'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  ChevronDown,
  Download,
  FileUp,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { DEFAULT_LOCALE, readStoredLocale, t, writeStoredLocale } from '@/lib/i18n';

const AGENT_LABELS = {
  zcode: 'ZCode',
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  kimi: 'Kimi Code',
};

const ITEM_KEYS = {
  'zcode.providers': 'cfgItemZcodeProviders',
  'zcode.settings': 'cfgItemZcodeSettings',
  'zcode.plugins': 'cfgItemZcodePlugins',
  'claude.settings': 'cfgItemClaudeSettings',
  'codex.config': 'cfgItemCodexConfig',
  'opencode.config-json': 'cfgItemOpenCodeJson',
  'opencode.config-jsonc': 'cfgItemOpenCodeJsonc',
  'kimi.config': 'cfgItemKimiConfig',
  'kimi.tui': 'cfgItemKimiTui',
  'kimi.mcp': 'cfgItemKimiMcp',
};

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

function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formatBytes(value, locale) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB`;
}

function formatDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toLocaleString(locale) : '—';
}

function toggleIn(setter, id) {
  setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function ItemPreview({ item, selected, onSelect, expanded, onExpand, locale, tx, mode }) {
  const label = tx(ITEM_KEYS[item.id] || item.label);
  return (
    <article className={`config-item${item.exists === false ? ' config-item-missing' : ''}`}>
      <div className="config-item-main">
        <label className="config-choice">
          <input
            type="checkbox"
            checked={selected}
            disabled={(mode === 'export' && !item.exportable) || (mode === 'import' && item.importable === false)}
            onChange={() => onSelect(item.id)}
          />
          <span className="config-choice-box" aria-hidden="true" />
          <span className="config-choice-copy">
            <b>{label}</b>
            <span>{item.fileName} · {String(item.format).toUpperCase()}</span>
          </span>
        </label>
        <div className="config-item-state">
          {mode === 'export' ? (
            item.error ? <span className="tag tag-error">{tx('cfgUnreadable')}</span> :
              item.exists && !item.exportable ? <span className="tag tag-warn">{tx('cfgTooLarge')}</span> :
                item.exists ? <span className="tag tag-ok">{tx('cfgFound')}</span> : <span className="tag">{tx('cfgMissing')}</span>
          ) : item.importable === false ? (
            <span className="tag tag-error">{tx('cfgInvalidDestination')}</span>
          ) : item.destinationExists ? (
            <span className="tag tag-warn">{tx('cfgWillBackup')}</span>
          ) : (
            <span className="tag tag-ok">{tx('cfgWillCreate')}</span>
          )}
          {item.preview != null && (
            <button className={`preview-toggle${expanded ? ' open' : ''}`} type="button" onClick={() => onExpand(item.id)}>
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
              {expanded ? tx('cfgHidePreview') : tx('cfgShowPreview')}
            </button>
          )}
        </div>
      </div>

      <dl className="config-meta">
        <div><dt>{tx(mode === 'export' ? 'cfgPath' : 'cfgDestination')}</dt><dd title={item.path}>{item.path}</dd></div>
        <div><dt>{tx('cfgSize')}</dt><dd>{formatBytes(item.size, locale)}</dd></div>
        {mode === 'export' && <div><dt>{tx('cfgModified')}</dt><dd>{formatDate(item.modifiedAt, locale)}</dd></div>}
      </dl>

      {expanded && item.preview != null && (
        <div className="config-preview">
          <div className="config-preview-head">
            <span>{tx('cfgRedactedPreview')}</span>
            {item.truncated && <span>{tx('cfgPreviewTruncated')}</span>}
          </div>
          <pre>{item.preview}</pre>
        </div>
      )}
    </article>
  );
}

export default function ConfigPage() {
  const [locale, setLocaleState] = useState(DEFAULT_LOCALE);
  const [inventory, setInventory] = useState(null);
  const [exportSelection, setExportSelection] = useState(new Set());
  const [importSelection, setImportSelection] = useState(new Set());
  const [expandedExport, setExpandedExport] = useState(new Set());
  const [expandedImport, setExpandedImport] = useState(new Set());
  const [bundle, setBundle] = useState(null);
  const [bundlePreview, setBundlePreview] = useState(null);
  const [bundleName, setBundleName] = useState('');
  const [lastImport, setLastImport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const fileRef = useRef(null);

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
      setExportSelection((current) => {
        const available = new Set(data.agents.flatMap((agent) => agent.items).filter((item) => item.exportable).map((item) => item.id));
        if (current.size === 0) return available;
        return new Set([...current].filter((id) => available.has(id)));
      });
      setError(null);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const availableItems = useMemo(
    () => inventory?.agents.flatMap((agent) => agent.items).filter((item) => item.exportable) ?? [],
    [inventory],
  );

  const exportConfigs = async () => {
    setBusy('export');
    setError(null);
    setNotice(null);
    try {
      const res = await postJson('/api/config/export', { items: [...exportSelection] });
      if (!res.ok) await responseJson(res);
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const name = disposition.match(/filename="([^"]+)"/)?.[1] || `toksight-config-${Date.now()}.toksight-config.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(tx('cfgExportDone', { n: exportSelection.size }));
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(null);
    }
  };

  const chooseBundle = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('preview');
    setError(null);
    setNotice(null);
    setBundle(null);
    setBundlePreview(null);
    setLastImport(null);
    setImportSelection(new Set());
    setExpandedImport(new Set());
    setBundleName(file.name);
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error(tx('cfgFileTooLarge'));
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error(tx('cfgInvalidJson'));
      }
      const preview = await responseJson(await postJson('/api/config/import/preview', { bundle: parsed }));
      setBundle(parsed);
      setBundlePreview(preview);
      setImportSelection(new Set(preview.items.filter((item) => item.importable !== false).map((item) => item.id)));
      setExpandedImport(new Set());
    } catch (err) {
      setError(String(err?.message || err));
      setBundleName('');
    } finally {
      setBusy(null);
    }
  };

  const importConfigs = async () => {
    if (!bundle || importSelection.size === 0) return;
    if (!window.confirm(tx('cfgConfirm', { n: importSelection.size }))) return;
    setBusy('import');
    setError(null);
    setNotice(null);
    try {
      const result = await responseJson(await postJson('/api/config/import', {
        bundle,
        items: [...importSelection],
      }));
      setNotice(tx('cfgImportDone', { n: result.imported.length, backups: result.backups.length }));
      setLastImport(result);
      setBundle(null);
      setBundlePreview(null);
      setBundleName('');
      setImportSelection(new Set());
      await load();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(null);
    }
  };

  const selectAllExports = () => setExportSelection(new Set(availableItems.map((item) => item.id)));
  const selectAllImports = () => setImportSelection(new Set(bundlePreview?.items.filter((item) => item.importable !== false).map((item) => item.id) ?? []));

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
            <button className="btn" type="button" onClick={load} disabled={loading || Boolean(busy)}>
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
        {notice && (
          <div className="banner success" role="status">
            <Check size={15} strokeWidth={2} aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}
        {inventory?.warnings?.map((warning, index) => (
          <div className="banner warn" key={`${warning}-${index}`}>
            <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
            <span>{warning}</span>
          </div>
        ))}

        <div className="config-stack">
          <section className="config-pane" aria-labelledby="config-export-title">
            <div className="config-pane-head">
              <div>
                <span className="config-step">{tx('cfgExportStep')}</span>
                <h2 id="config-export-title">{tx('cfgExportTitle')}</h2>
                <p>{tx('cfgExportDesc')}</p>
              </div>
              <div className="config-select-actions">
                <button type="button" onClick={selectAllExports}>{tx('cfgSelectAll')}</button>
                <button type="button" onClick={() => setExportSelection(new Set())}>{tx('cfgClear')}</button>
              </div>
            </div>

            {loading && !inventory ? (
              <div className="config-loading"><span className="skel" /><span className="skel" /><span className="skel" /></div>
            ) : inventory ? (
              <div className="config-agents">
                {inventory.agents.map((agent) => (
                  <section className="config-agent" key={agent.id}>
                    <div className="config-agent-head">
                      <h3>{AGENT_LABELS[agent.id] || agent.label}</h3>
                      <span>{agent.items.filter((item) => item.exportable).length}/{agent.items.length}</span>
                    </div>
                    {agent.items.map((item) => (
                      <ItemPreview
                        key={item.id}
                        item={item}
                        selected={exportSelection.has(item.id)}
                        onSelect={(id) => toggleIn(setExportSelection, id)}
                        expanded={expandedExport.has(item.id)}
                        onExpand={(id) => toggleIn(setExpandedExport, id)}
                        locale={locale}
                        tx={tx}
                        mode="export"
                      />
                    ))}
                  </section>
                ))}
              </div>
            ) : (
              <div className="config-empty">{tx('cfgLoadEmpty')}</div>
            )}

            <div className="config-pane-foot">
              <span>{tx('cfgSelected', { n: exportSelection.size })}</span>
              <button className="btn" type="button" disabled={exportSelection.size === 0 || Boolean(busy)} onClick={exportConfigs}>
                <Download size={14} strokeWidth={2} aria-hidden="true" />
                {busy === 'export' ? tx('cfgExporting') : tx('cfgExportButton')}
              </button>
            </div>
          </section>

          <section className="config-pane" aria-labelledby="config-import-title">
            <div className="config-pane-head">
              <div>
                <span className="config-step">{tx('cfgImportStep')}</span>
                <h2 id="config-import-title">{tx('cfgImportTitle')}</h2>
                <p>{tx('cfgImportDesc')}</p>
              </div>
            </div>

            <div className="config-drop">
              <FileUp size={18} strokeWidth={2} aria-hidden="true" />
              <div>
                <b>{bundleName || tx('cfgChooseBundle')}</b>
                <span>{tx('cfgBundleHint')}</span>
              </div>
              <input ref={fileRef} type="file" accept=".json,.toksight-config.json,application/json" onChange={chooseBundle} tabIndex={-1} aria-hidden="true" />
              <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
                <FileUp size={14} strokeWidth={2} aria-hidden="true" />
                {busy === 'preview' ? tx('cfgChecking') : tx('cfgBrowse')}
              </button>
            </div>

            {bundlePreview ? (
              <>
                <div className="config-bundle-meta">
                  <span>{tx('cfgBundleVersion', { version: bundlePreview.version })}</span>
                  <span>{tx('cfgBundleCreated', { time: formatDate(bundlePreview.createdAt, locale) })}</span>
                </div>
                <div className="config-select-actions config-select-actions-wide">
                  <button type="button" onClick={selectAllImports}>{tx('cfgSelectAll')}</button>
                  <button type="button" onClick={() => setImportSelection(new Set())}>{tx('cfgClear')}</button>
                </div>
                <div className="config-agents config-import-items">
                  {bundlePreview.items.map((item) => (
                    <ItemPreview
                      key={item.id}
                      item={item}
                      selected={importSelection.has(item.id)}
                      onSelect={(id) => toggleIn(setImportSelection, id)}
                      expanded={expandedImport.has(item.id)}
                      onExpand={(id) => toggleIn(setExpandedImport, id)}
                      locale={locale}
                      tx={tx}
                      mode="import"
                    />
                  ))}
                </div>
              </>
            ) : lastImport ? (
              <section className="config-result" aria-label={tx('cfgResultTitle')}>
                <h3><Check size={16} strokeWidth={2} aria-hidden="true" />{tx('cfgResultTitle')}</h3>
                <div>
                  <b>{tx('cfgResultImported')}</b>
                  <ul>{lastImport.imported.map((item) => <li key={item.id}>{item.path}</li>)}</ul>
                </div>
                <div>
                  <b>{tx('cfgResultBackups')}</b>
                  {lastImport.backups.length ? (
                    <ul>{lastImport.backups.map((item) => <li key={item.id}>{item.backupPath}</li>)}</ul>
                  ) : <p>{tx('cfgNoBackups')}</p>}
                </div>
              </section>
            ) : (
              <div className="config-empty config-empty-import">
                <span>01</span>
                <p>{tx('cfgImportEmpty')}</p>
              </div>
            )}

            <div className="config-pane-foot">
              <span>{tx('cfgSelected', { n: importSelection.size })}</span>
              <button className="btn" type="button" disabled={!bundle || importSelection.size === 0 || Boolean(busy)} onClick={importConfigs}>
                <FileUp size={14} strokeWidth={2} aria-hidden="true" />
                {busy === 'import' ? tx('cfgImporting') : tx('cfgImportButton')}
              </button>
            </div>
          </section>
        </div>

        <footer className="foot">
          <span>{tx('cfgFootScope')}</span>
          <span>{tx('cfgFootBackup')}</span>
          <span>{tx('cfgFootLocal')}</span>
        </footer>
      </div>
    </main>
  );
}
