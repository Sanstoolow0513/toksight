export const ITEM_KEYS = {
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

export const AUTH_METHODS = {
  oauth: 'amOauth',
  chatgpt: 'amChatgpt',
  apikey: 'amApikey',
  envKey: 'amEnvkey',
  file: 'amFile',
  providers: 'amProviders',
};

export const AUTH_VIA = {
  oauth: 'avOauth',
  key: 'avKey',
  env: 'avEnv',
};

export async function responseJson(res) {
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

export function formatBytes(value, locale) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB`;
}

export function formatDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toLocaleString(locale) : '—';
}

