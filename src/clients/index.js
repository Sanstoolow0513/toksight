import * as claude from './claude.js';
import * as codex from './codex.js';
import * as cursor from './cursor.js';
import * as kimi from './kimi.js';
import * as opencode from './opencode.js';
import * as zcode from './zcode.js';

export const clients = { zcode, claude, codex, opencode, kimi, cursor };

export const clientAliases = {
  claude: 'claude',
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
  opencode: 'opencode',
  kimi: 'kimi',
  'kimi-code': 'kimi',
  zcode: 'zcode',
};

export function resolveClientIds(raw) {
  if (!raw) return null;
  const ids = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const resolved = [];
  for (const id of ids) {
    const canonical = Object.hasOwn(clientAliases, id) ? clientAliases[id] : null;
    if (!canonical) {
      throw new Error(`unknown client "${id}" (supported: ${Object.keys(clients).join(', ')})`);
    }
    if (!resolved.includes(canonical)) resolved.push(canonical);
  }
  return resolved;
}
