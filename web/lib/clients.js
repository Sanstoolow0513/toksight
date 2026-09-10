// Single source of truth for agent display names (previously duplicated in
// app/page.js and DashboardFilters). Unknown ids fall back to the raw id so
// a new client id can never crash the UI.

export const CLIENT_LABELS = {
  zcode: 'ZCode',
  claude: 'Claude Code',
  codex: 'Codex CLI',
  opencode: 'OpenCode',
  kimi: 'Kimi Code',
};

export const CLIENTS = Object.entries(CLIENT_LABELS).map(([id, label]) => ({ id, label }));

export const clientLabel = (id) => CLIENT_LABELS[id] || id;
