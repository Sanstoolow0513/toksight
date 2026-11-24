import os from 'node:os';
import path from 'node:path';
import { listDirectory, readJson, readJsonl, walkFiles } from '../fsutils.js';

export const id = 'gemini';
export const label = 'Gemini CLI';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  return [path.join(env.GEMINI_CLI_HOME || home, '.gemini', 'tmp')];
}

async function readSession(file, entries) {
  let sessionId = path.basename(file, path.extname(file));
  let directory = null;
  const messages = new Map();

  function recordMessage(message) {
    if (message?.type !== 'gemini' || typeof message.id !== 'string' || !message.id || !message.tokens) return;
    const { input = 0, output = 0, cached = 0, tool = 0, thoughts = 0 } = message.tokens;
    if (![input, output, cached, tool, thoughts].every(n => Number.isSafeInteger(n) && n >= 0) || cached > input) return;
    if (!(input || output || tool || thoughts)) return;
    const time = Date.parse(message.timestamp);
    messages.set(message.id, {
      model: typeof message.model === 'string' && message.model || 'unknown',
      timestamp: Number.isFinite(time) ? time : null,
      inputTokens: input - cached + tool, cacheReadTokens: cached,
      outputTokens: output + thoughts, reasoningTokens: thoughts,
    });
  }

  function readRecord(record) {
    if (!record) return;
    const meta = record.$set ?? record;
    if (typeof meta.sessionId === 'string' && meta.sessionId) sessionId = meta.sessionId;
    if (Array.isArray(meta.directories) && typeof meta.directories[0] === 'string') directory = meta.directories[0];
    if (Array.isArray(meta.messages)) {
      for (const message of meta.messages) recordMessage(message);
    } else {
      recordMessage(record);
    }
  }
  if (file.endsWith('.jsonl')) await readJsonl(file, readRecord);
  else readRecord(await readJson(file));

  // Rewinds change the visible chat, but the earlier requests still incurred usage.
  for (const [messageId, fields] of messages) {
    entries.set(JSON.stringify([sessionId, messageId]), {
      client: id, sessionId, directory, title: null, cacheWriteTokens: 0, costUsd: null, ...fields,
    });
  }
}

export async function collect({ env, home, roots } = {}) {
  const entries = new Map();
  const warnings = [];
  for (const root of roots ?? sourceRoots({ env, home })) {
    for (const project of await listDirectory(root, warnings)) {
      if (!project.isDirectory()) continue;
      const chats = path.join(root, project.name, 'chats');
      const found = await walkFiles(chats, { maxDepth: 1, filter: name => /\.jsonl?$/.test(name) });
      for (const warning of found.warnings) warnings.push(warning);
      for (const file of found.files) {
        const main = path.dirname(file) === chats;
        if (main ? !path.basename(file).startsWith('session-') : !file.endsWith('.jsonl')) continue;
        try {
          await readSession(file, entries);
        } catch (err) {
          warnings.push(`gemini: cannot read ${file} (${err.code || err.message})`);
        }
      }
    }
  }
  return { entries: [...entries.values()], warnings };
}
