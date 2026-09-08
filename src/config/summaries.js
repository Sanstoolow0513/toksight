import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { obj } from './parse.js';
import { redactString, SENSITIVE_KEY } from './redact.js';
import { MAX_MODELS } from './limits.js';

function joinList(values, cap = 6) {
  const list = values.slice(0, cap).map(String);
  const rest = values.length - list.length;
  return rest > 0 ? `${list.join(', ')} (+${rest})` : list.join(', ');
}

function providerRow(name, row) {
  const options = obj(row?.options);
  return {
    name: String(name),
    kind: row?.kind || row?.type ? String(row.kind ?? row.type) : null,
    baseURL: typeof options.baseURL === 'string' ? options.baseURL : typeof row?.base_url === 'string' ? row.base_url : null,
    apiKeySet: Boolean(options.apiKey || row?.api_key),
    authVia: row?.oauth || row?.oauth_storage ? 'oauth' : options.apiKey || row?.api_key ? 'key' : null,
    enabled: row?.enabled == null ? null : Boolean(row.enabled),
    modelCount: row?.models && typeof row.models === 'object' ? Object.keys(row.models).length : null,
  };
}

async function summarizeClaude({ data }) {
  const settings = obj(data.get('claude.settings')?.parsed);
  const state = obj(data.get('claude.state')?.parsed);
  const creds = data.get('claude.credentials');
  const env = obj(settings.env);
  const facts = [];

  // Non-sensitive env entries are the meat of a third-party-endpoint setup —
  // show each one (ANTHROPIC_MODEL, ANTHROPIC_BASE_URL, ...). Sensitive names
  // were already filtered by the preview redactor; here they are skipped so
  // they never reach the summary either.
  for (const [name, value] of Object.entries(env)) {
    if (!SENSITIVE_KEY.test(name) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      facts.push({ key: name, value: String(value) });
    }
  }
  if (settings.model) facts.push({ key: 'model', value: String(settings.model) });
  if (settings.theme) facts.push({ key: 'factTheme', value: String(settings.theme) });
  if (settings.autoUpdatesChannel) facts.push({ key: 'factAutoUpdate', value: String(settings.autoUpdatesChannel) });
  if (state.installMethod) facts.push({ key: 'factInstallMethod', value: String(state.installMethod) });
  if (state.autoUpdates != null) facts.push({ key: 'factAutoUpdates', value: String(state.autoUpdates) });

  const apiKeyEnv = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
  const auth = creds?.exists
    ? { method: 'oauth', detail: '.claude/.credentials.json' }
    : apiKeyEnv
      ? { method: 'envKey', detail: env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN' }
      : state.oauthAccount
        ? { method: 'oauth', detail: '.claude.json' }
        : null;

  return {
    defaultModel: settings.model || env.ANTHROPIC_MODEL || null,
    auth,
    facts,
    providers: [],
    models: [],
    mcpServers: Object.keys(obj(state.mcpServers)),
  };
}

async function summarizeCodex({ data, env, home }) {
  const cfg = obj(data.get('codex.config')?.parsed);
  const authExtract = data.get('codex.auth')?.extract || null;
  const varNames = data.get('codex.env')?.extract?.varNames || [];

  let profiles = [];
  try {
    profiles = (await readdir(env.CODEX_HOME || path.join(home, '.codex')))
      .filter((name) => /\.config\.toml$/.test(name))
      .map((name) => name.replace(/\.config\.toml$/, ''));
  } catch {
    // No codex home is normal — nothing was configured yet.
  }

  const facts = [];
  if (cfg.approval_policy) facts.push({ key: 'factApproval', value: String(cfg.approval_policy) });
  if (cfg.sandbox_mode) facts.push({ key: 'factSandbox', value: String(cfg.sandbox_mode) });
  if (obj(cfg.windows).sandbox) facts.push({ key: 'factWindowsSandbox', value: String(cfg.windows.sandbox) });
  if (cfg.model_provider) facts.push({ key: 'factActiveProvider', value: String(cfg.model_provider) });
  const trusted = Object.entries(obj(cfg.projects))
    .filter(([, value]) => obj(value).trust_level === 'trusted')
    .map(([projectPath]) => projectPath);
  if (trusted.length) facts.push({ key: 'factTrustedProjects', value: joinList(trusted, 4) });
  if (profiles.length) facts.push({ key: 'factProfiles', value: joinList(profiles) });
  if (varNames.length) facts.push({ key: 'factEnvFile', value: joinList(varNames) });

  const authMode = authExtract?.authMode;
  const auth = authMode === 'chatgpt'
    ? { method: 'chatgpt' }
    : authMode === 'apikey'
      ? { method: 'apikey', detail: 'auth.json' }
      : data.get('codex.auth')?.exists
        ? { method: 'file', detail: 'auth.json' }
        : null;

  return {
    defaultModel: cfg.model ? (cfg.model_reasoning_effort ? `${cfg.model} · ${cfg.model_reasoning_effort}` : String(cfg.model)) : null,
    auth,
    facts,
    providers: Object.entries(obj(cfg.model_providers)).map(([name, row]) => ({
      ...providerRow(name, row),
      kind: row?.wire_api ? String(row.wire_api) : row?.name ? String(row.name) : null,
      authVia: row?.api_key ? 'key' : row?.env_key ? 'env' : null,
    })),
    models: [],
    mcpServers: Object.keys(obj(cfg.mcp_servers)),
  };
}

async function summarizeOpenCode({ data }) {
  const cfg = obj(data.get('opencode.config-json')?.parsed || data.get('opencode.config-jsonc')?.parsed);
  const authKeyNames = data.get('opencode.auth')?.extract?.keyNames || [];
  const recent = Array.isArray(data.get('opencode.state-model')?.parsed?.recent)
    ? data.get('opencode.state-model').parsed.recent
    : [];

  const facts = [];
  if (cfg.autoupdate != null) facts.push({ key: 'factAutoUpdate', value: String(cfg.autoupdate) });
  if (cfg.share != null) facts.push({ key: 'factShare', value: String(cfg.share) });
  const disabled = Array.isArray(cfg.disabled_providers) ? cfg.disabled_providers : [];
  if (disabled.length) facts.push({ key: 'factDisabledProviders', value: joinList(disabled) });
  const recentIds = recent
    .filter((row) => row && typeof row === 'object')
    .map((row) => `${row.providerID}/${row.modelID}`)
    .filter((value) => !value.includes('undefined'));
  if (recentIds.length) facts.push({ key: 'factRecentModels', value: joinList(recentIds, 4) });

  return {
    defaultModel: cfg.model || recentIds[0] || null,
    auth: authKeyNames.length ? { method: 'providers', detail: joinList(authKeyNames, 4) } : null,
    facts,
    providers: Object.entries(obj(cfg.provider)).map(([name, row]) => providerRow(name, row)),
    models: [],
    mcpServers: Object.keys(obj(cfg.mcp)),
  };
}

async function summarizeKimi({ data }) {
  const cfg = obj(data.get('kimi.config')?.parsed);
  const tui = obj(data.get('kimi.tui')?.parsed);
  const mcp = obj(data.get('kimi.mcp')?.parsed);
  const region = typeof data.get('kimi.region')?.raw === 'string' ? data.get('kimi.region').raw.trim() : null;

  const facts = [];
  if (cfg.default_permission_mode) facts.push({ key: 'factPermissionMode', value: String(cfg.default_permission_mode) });
  if (obj(cfg.thinking).enabled) {
    facts.push({ key: 'factThinking', value: cfg.thinking.effort ? String(cfg.thinking.effort) : 'on' });
  }
  if (region) facts.push({ key: 'factRegion', value: region });
  if (tui.theme) facts.push({ key: 'factTheme', value: String(tui.theme) });
  if (obj(tui.notifications).enabled != null) {
    facts.push({ key: 'factNotifications', value: String(tui.notifications.enabled) });
  }
  if (obj(tui.upgrade).auto_install != null) facts.push({ key: 'factAutoInstall', value: String(tui.upgrade.auto_install) });

  const providers = Object.entries(obj(cfg.providers)).map(([name, row]) => ({
    ...providerRow(name, row),
    kind: row?.type ? String(row.type) : null,
    authVia: row?.oauth ? 'oauth' : row?.api_key ? 'key' : null,
  }));

  const models = Object.entries(obj(cfg.models)).map(([name, row]) => ({
    name: String(name),
    provider: row?.provider ? String(row.provider) : null,
    contextTokens: Number.isFinite(row?.max_context_size) ? row.max_context_size : null,
  }));

  return {
    defaultModel: cfg.default_model ? String(cfg.default_model) : null,
    auth: data.get('kimi.credentials')?.exists ? { method: 'oauth', detail: 'credentials/kimi-code.json' } : null,
    facts,
    providers,
    models,
    mcpServers: Object.keys(obj(mcp.mcpServers)),
  };
}

async function summarizeZcode({ data }) {
  const v2 = obj(data.get('zcode.providers')?.parsed);
  const setting = obj(data.get('zcode.settings')?.parsed);
  const cli = obj(data.get('zcode.plugins')?.parsed);
  const credKeyNames = data.get('zcode.credentials')?.extract?.keyNames || [];

  const facts = [];
  if (setting.locale) facts.push({ key: 'factLocale', value: String(setting.locale) });
  if (setting.memoryEnabled != null) facts.push({ key: 'factMemory', value: String(setting.memoryEnabled) });
  if (setting.autoDownloadAndInstallUpdates != null) {
    facts.push({ key: 'factAutoInstall', value: String(setting.autoDownloadAndInstallUpdates) });
  }
  if (setting.messageStreamShowReasoning != null) {
    facts.push({ key: 'factShowReasoning', value: String(setting.messageStreamShowReasoning) });
  }
  const enabledPlugins = Object.entries(obj(obj(cli.plugins).enabledPlugins))
    .filter(([, value]) => value)
    .map(([name]) => name);
  if (enabledPlugins.length) facts.push({ key: 'factPlugins', value: joinList(enabledPlugins, 6) });
  const suppressed = Array.isArray(obj(cli.plugins).suppressedBuiltins) ? cli.plugins.suppressedBuiltins : [];
  if (suppressed.length) facts.push({ key: 'factSuppressedPlugins', value: String(suppressed.length) });

  const providers = Object.entries(obj(v2.provider)).map(([name, row]) => ({
    ...providerRow(name, row),
    kind: row?.kind ? String(row.kind) : null,
  }));

  const models = [];
  for (const [providerName, row] of Object.entries(obj(v2.provider))) {
    for (const [modelName, modelRow] of Object.entries(obj(row?.models))) {
      models.push({
        name: String(modelName),
        provider: String(providerName),
        contextTokens: Number.isFinite(obj(modelRow?.limit).context) ? modelRow.limit.context : null,
      });
    }
  }

  return {
    defaultModel: null,
    auth: credKeyNames.some((key) => /access_token|jwttoken|refresh/i.test(key))
      ? { method: 'oauth', detail: 'z.ai' }
      : credKeyNames.length
        ? { method: 'file', detail: 'v2/credentials.json' }
        : null,
    facts,
    providers,
    models,
    mcpServers: [],
  };
}

export const SUMMARIZERS = {
  zcode: summarizeZcode,
  claude: summarizeClaude,
  codex: summarizeCodex,
  opencode: summarizeOpenCode,
  kimi: summarizeKimi,
};

export function normalizeSummary(summary) {
  const raw = summary || {};
  const facts = (Array.isArray(raw.facts) ? raw.facts : [])
    .filter((fact) => fact && fact.key && fact.value != null && fact.value !== '')
    .slice(0, 40)
    .map((fact) => ({ key: String(fact.key), value: redactString(String(fact.value)) }));
  return {
    defaultModel: raw.defaultModel ? redactString(String(raw.defaultModel)) : null,
    auth: raw.auth && raw.auth.method
      ? { method: String(raw.auth.method), detail: raw.auth.detail ? redactString(String(raw.auth.detail)) : null }
      : null,
    facts,
    providers: (Array.isArray(raw.providers) ? raw.providers : []).map((row) => ({
      name: String(row?.name ?? ''),
      kind: row?.kind ? String(row.kind) : null,
      baseURL: row?.baseURL ? redactString(String(row.baseURL)) : null,
      apiKeySet: Boolean(row?.apiKeySet),
      authVia: row?.authVia ? String(row.authVia) : null,
      enabled: row?.enabled == null ? null : Boolean(row.enabled),
      modelCount: Number.isFinite(row?.modelCount) ? row.modelCount : null,
    })),
    models: (Array.isArray(raw.models) ? raw.models : []).slice(0, MAX_MODELS).map((row) => ({
      name: String(row?.name ?? ''),
      provider: row?.provider ? String(row.provider) : null,
      contextTokens: Number.isFinite(row?.contextTokens) ? row.contextTokens : null,
    })),
    mcpServers: (Array.isArray(raw.mcpServers) ? raw.mcpServers : []).map(String).slice(0, 20),
  };
}

