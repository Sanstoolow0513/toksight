import * as claude from './claude.js';
import * as codex from './codex.js';
import * as gemini from './gemini.js';
import * as kimi from './kimi.js';
import * as opencode from './opencode.js';
import * as zcode from './zcode.js';

export const clients = { zcode, claude, codex, opencode, gemini, kimi };

export const clientAliases = {
  claude: 'claude',
  'claude-code': 'claude',
  codex: 'codex',
  opencode: 'opencode',
  gemini: 'gemini',
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
    const canonical = clientAliases[id];
    if (!canonical) {
      throw new Error(`unknown client "${id}" (supported: ${Object.keys(clients).join(', ')})`);
    }
    if (!resolved.includes(canonical)) resolved.push(canonical);
  }
  return resolved;
}
