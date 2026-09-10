'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { fmtTokens } from '@/lib/format';
import { AUTH_METHODS, AUTH_VIA } from '@/lib/config';
import FileCard from './FileCard';

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

export default function AgentCard({ agent, locale, tx }) {
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
              <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
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

