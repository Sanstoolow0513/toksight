import os from 'node:os';
import path from 'node:path';
import { listDirectory, readJson, readJsonl, walkFiles } from '../fsutils.js';

export const id = 'gemini';
export const label = 'Gemini CLI';

export function sourceRoots({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const base = env.GEMINI_CLI_HOME || home;
  const roots = [path.join(base, '.gemini', 'tmp')];
  if (platform === 'darwin') roots.push(path.join(base, '.cache', '.gemini', 'tmp'));
  return roots;
}

async function readSession(file, requests, imports) {
  let sessionId = path.basename(file, path.extname(file));
  let directory = null;
  let importedAt = Infinity;
  const messages = new Map();

  function recordMessage(message) {
    // --session-file prepends this info message to the copied conversation.
    if (message?.type === 'info' && typeof message.id === 'string' && /^import-\d+$/.test(message.id) &&
        typeof message.content === 'string' && message.content.startsWith('Imported session from ')) {
      const timestamp = Date.parse(message.timestamp);
      const time = Number.isFinite(timestamp) ? timestamp : Number(message.id.slice(7));
      if (Number.isSafeInteger(time)) importedAt = Math.min(importedAt, time);
      return;
    }
    if (message?.type !== 'gemini' || typeof message.id !== 'string' || !message.id || !message.tokens) return;
    const { input = 0, output = 0, cached = 0, tool = 0, thoughts = 0 } = message.tokens;
    if (![input, output, cached, tool, thoughts].every(n => Number.isSafeInteger(n) && n >= 0) || cached > input) return;
    if (!(input || output || tool || thoughts)) return;
    const time = Date.parse(message.timestamp);
    const model = typeof message.model === 'string' && message.model || 'unknown';
    const identity = JSON.stringify([message.id, message.timestamp, model, input, cached, tool, output, thoughts]);
    const fields = {
      model,
      timestamp: Number.isFinite(time) ? time : null,
      inputTokens: input - cached + tool, cacheReadTokens: cached,
      outputTokens: output + thoughts, reasoningTokens: thoughts,
    };
    messages.set(message.id, { identity, fields });
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
  if (Number.isFinite(importedAt)) imports.set(sessionId, Math.min(imports.get(sessionId) ?? Infinity, importedAt));
  for (const [messageId, { identity, fields }] of messages) {
    const entry = {
      client: id, sessionId, directory, title: null, cacheWriteTokens: 0, costUsd: null, ...fields,
    };
    requests.set(JSON.stringify([sessionId, messageId]), { identity, entry });
  }
}

function resolveImports(requests, imports) {
  const entries = [];
  const originals = new Set();
  const copies = new Map();
  for (const { identity, entry } of requests.values()) {
    const importedAt = imports.get(entry.sessionId);
    if (importedAt === undefined || (entry.timestamp !== null && entry.timestamp > importedAt)) {
      entries.push(entry);
      if (imports.size) originals.add(identity);
      continue;
    }
    const previous = copies.get(identity);
    if (!previous || importedAt < previous.importedAt ||
        (importedAt === previous.importedAt && entry.sessionId < previous.entry.sessionId)) {
      copies.set(identity, { importedAt, entry });
    }
  }
  for (const [identity, { entry }] of copies) {
    if (!originals.has(identity)) entries.push(entry);
  }
  return entries;
}

export async function collect({ env, home, platform, roots } = {}) {
  const requests = new Map();
  const imports = new Map();
  const warnings = [];
  for (const root of roots ?? sourceRoots({ env, home, platform })) {
    for (const project of await listDirectory(root, warnings)) {
      if (!project.isDirectory()) continue;
      const chats = path.join(root, project.name, 'chats');
      const found = await walkFiles(chats, { maxDepth: 1, filter: name => /\.jsonl?$/.test(name) });
      for (const warning of found.warnings) warnings.push(warning);
      for (const file of found.files) {
        const main = path.dirname(file) === chats;
        if (main ? !path.basename(file).startsWith('session-') : !file.endsWith('.jsonl')) continue;
        try {
          await readSession(file, requests, imports);
        } catch (err) {
          warnings.push(`gemini: cannot read ${file} (${err.code || err.message})`);
        }
      }
    }
  }
  return { entries: resolveImports(requests, imports), warnings };
}
