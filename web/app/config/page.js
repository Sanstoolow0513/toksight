'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { DEFAULT_LOCALE, readStoredLocale, t, writeStoredLocale } from '@/lib/i18n';
import { fmtTokens } from '@/lib/format';
import TransferPanel from '@/components/TransferPanel';

const ITEM_KEYS = {
  'zcode.providers': 'cfgItemZcodeProviders',
  'zcode.settings': 'cfgItemZcodeSettings',
  'zcode.plugins': 'cfgItemZcodePlugins',
  'zcode.credentials': 'cfgItemZcodeCredentials',
  'claude.settings': 'cfgItemClaudeSettings',
  'claude.state': 'cfgItemClaudeState',
  'claude.credentials': 'cfgItemClaudeCredentials',
  'codex.config': 'cfgItemCodexConfig',
  'codex.auth': 'cfgItemCodexAuth',
  'codex.env': 'cfgItemCodexEnv',
  'opencode.config-json': 'cfgItemOpenCodeJson',
  'opencode.config-jsonc': 'cfgItemOpenCodeJsonc',
  'opencode.auth': 'cfgItemOpenCodeAuth',
  'opencode.state-model': 'cfgItemOpenCodeStateModel',
  'kimi.config': 'cfgItemKimiConfig',
  'kimi.tui': 'cfgItemKimiTui',
  'kimi.mcp': 'cfgItemKimiMcp',
  'kimi.region': 'cfgItemKimiRegion',
  'kimi.credentials': 'cfgItemKimiCredentials',
};

const AUTH_METHODS = {
  oauth: 'amOauth',
  chatgpt: 'amChatgpt',
  apikey: 'amApikey',
  envKey: 'amEnvkey',
  file: 'amFile',
  providers: 'amProviders',
};

const AUTH_VIA = {
  oauth: 'avOauth',
  key: 'avKey',
  env: 'avEnv',
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

function FileState({ file, tx }) {
  if (file.error) return <span className="tag tag-error">{tx('cfgUnreadable')}</span>;
  if (!file.exists) return <span className="tag">{tx('cfgMissing')}</span>;
  return <span className="tag tag-ok">{tx('cfgFound')}</span>;
}

function FileCard({ file, locale, tx }) {
  const label = tx(ITEM_KEYS[file.id] || 'cfgItemFallback');
  return (
    <article className={`config-file${file.exists ? '' : ' config-file-missing'}`}>
      <div className="config-file-head">
        <b>{label}</b>
        <span className="config-file-name">{file.fileName} · {String(file.format).toUpperCase()}</span>
        <FileState file={file} tx={tx} />
      </div>
      <dl className="config-meta">
        <div><dt>{tx('cfgPath')}</dt><dd title={file.path}>{file.path}</dd></div>
        <div><dt>{tx('cfgSize')}</dt><dd>{formatBytes(file.size, locale)}</dd></div>
        <div><dt>{tx('cfgModified')}</dt><dd>{formatDate(file.modifiedAt, locale)}</dd></div>
      </dl>
      {file.exists && file.preview != null && (
        <div className="config-preview">
          <div className="config-preview-head">
            <span>{tx('cfgRedactedPreview')}</span>
            {file.truncated && <span>{tx('cfgPreviewTruncated')}</span>}
          </div>
          <pre>{file.preview}</pre>
        </div>
      )}
      {file.exists && file.preview == null && !file.error && file.previewable === false && (
        <p className="config-file-note">{tx('cfgCredentialNote')}</p>
      )}
    </article>
  );
}

function ProvidersTable({ providers, tx }) {
  return (
    <div className="config-table-wrap">
      <table className="config-table">
        <thead>
          <tr>
            <th>{tx('colProvider')}</th>
            <th>{tx('colType')}</th>
            <th>{tx('colEndpoint')}</th>
            <th>{tx('colAuthCol')}</th>
            <th>{tx('colState')}</th>
            <th>{tx('colModelsCol')}</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((row) => (
            <tr key={row.name}>
              <td title={row.name}>{row.name}</td>
              <td>{row.kind || '—'}</td>
              <td title={row.baseURL || ''}>{row.baseURL || '—'}</td>
              <td>
                {row.authVia ? tx(AUTH_VIA[row.authVia]) || row.authVia : row.apiKeySet ? tx('avKey') : '—'}
              </td>
              <td>{row.enabled == null ? '—' : row.enabled ? tx('stateOn') : tx('stateOff')}</td>
              <td>{row.modelCount == null ? '—' : row.modelCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelsBlock({ models, tx }) {
  const groups = [];
  for (const model of models) {
    const last = groups[groups.length - 1];
    if (last && last.provider === model.provider) last.models.push(model);
    else groups.push({ provider: model.provider, models: [model] });
  }
  return (
    <div className="config-models">
      {groups.map((group) => (
        <div className="config-model-group" key={group.provider || 'none'}>
          <span className="config-model-provider">{group.provider || '—'}</span>
          <div className="config-chips">
            {group.models.map((model) => (
              <span className="chip" key={`${model.provider}/${model.name}`} title={model.provider ? `${model.provider}/${model.name}` : model.name}>
                {model.name}
                {model.contextTokens != null && <i>{fmtTokens(model.contextTokens)}</i>}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentCard({ agent, locale, tx }) {
  const [open, setOpen] = useState(false);
  const { summary } = agent;
  const foundFiles = agent.files.filter((file) => file.exists).length;
  const hasContent =
    summary.defaultModel || summary.auth || summary.facts.length > 0 ||
    summary.providers.length > 0 || summary.models.length > 0 || summary.mcpServers.length > 0;

  return (
    <section className="config-agent">
      <div className="config-agent-head">
        <div>
          <h3>{agent.label}</h3>
          <p>
            {tx('cfgAgentFiles', { found: foundFiles, total: agent.files.length })}
            {summary.providers.length > 0 && ` · ${tx('cfgAgentProviders', { n: summary.providers.length })}`}
            {summary.models.length > 0 && ` · ${tx('cfgAgentModels', { n: summary.models.length })}`}
          </p>
        </div>
        {summary.auth && (
          <span className="config-agent-badge" title={summary.auth.detail || undefined}>
            {tx(AUTH_METHODS[summary.auth.method]) || summary.auth.method}
          </span>
        )}
      </div>

      {!hasContent ? (
        <p className="config-agent-empty">{tx('cfgNoConfig')}</p>
      ) : (
        <div className="config-agent-body">
          {(summary.defaultModel || summary.auth || summary.mcpServers.length > 0) && (
            <dl className="config-kv">
              {summary.defaultModel != null && (
                <div><dt>{tx('cfgDefaultModel')}</dt><dd>{summary.defaultModel}</dd></div>
              )}
              {summary.auth && (
                <div>
                  <dt>{tx('cfgAuth')}</dt>
                  <dd>
                    {tx(AUTH_METHODS[summary.auth.method]) || summary.auth.method}
                    {summary.auth.detail && <span className="config-kv-detail"> · {summary.auth.detail}</span>}
                  </dd>
                </div>
              )}
              {summary.mcpServers.length > 0 && (
                <div>
                  <dt>{tx('cfgMcp')}</dt>
                  <dd>{tx('cfgMcpCount', { n: summary.mcpServers.length })}<span className="config-kv-detail"> · {summary.mcpServers.join(', ')}</span></dd>
                </div>
              )}
            </dl>
          )}

          {summary.facts.length > 0 && (
            <ul className="config-facts">
              {summary.facts.map((fact) => (
                <li key={fact.key}>
                  <span>{tx(fact.key)}</span>
                  <b>{fact.value}</b>
                </li>
              ))}
            </ul>
          )}

          {summary.providers.length > 0 && <ProvidersTable providers={summary.providers} tx={tx} />}
          {summary.models.length > 0 && <ModelsBlock models={summary.models} tx={tx} />}

          <div className="config-files">
            <button
              className={`config-files-toggle${open ? ' open' : ''}`}
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
            >
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
              {open ? tx('cfgHideFiles') : tx('cfgShowFiles', { n: agent.files.length })}
            </button>
            {open && (
              <div className="config-files-list">
                {agent.files.map((file) => (
                  <FileCard file={file} key={file.id} locale={locale} tx={tx} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
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

        <TransferPanel agents={inventory?.agents} locale={locale} tx={tx} onImported={load} />

        <footer className="foot">
          <span>{tx('cfgFootScope')}</span>
          <span>{tx('cfgFootRedact')}</span>
          <span>{tx('cfgFootLocal')}</span>
        </footer>
      </div>
    </main>
  );
}
