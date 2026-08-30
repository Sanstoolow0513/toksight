import os from 'node:os';
import path from 'node:path';
import { walkFiles, readJson } from '../fsutils.js';

export const id = 'gemini';
export const label = 'Gemini CLI';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  const base = env.GEMINI_CLI_HOME || path.join(home, '.gemini');
  return [path.join(base, 'tmp')];
}

// Gemini CLI saves chat history under ~/.gemini/tmp/<projectHash>/chats/*.json.
// Messages may carry a `usageMetadata` object (Gemini API style). Thoughts are
// reported separately from candidates, so output = candidates + thoughts.
// The model is not stored per message; fall back to a generic label.
export async function collect({ env, home, roots } = {}) {
  const scanRoots = roots ?? sourceRoots({ env, home });
  const warnings = [];
  const entries = [];

  const files = [];
  for (const root of scanRoots) {
    files.push(
      ...(
        await walkFiles(root, {
          filter: (name, ) => name.endsWith('.json'),
        })
      ).filter((f) => f.split(path.sep).includes('chats')),
    );
  }

  for (const file of files) {
    let o = null;
    try {
      o = await readJson(file);
    } catch {
      continue;
    }
    const messages = Array.isArray(o?.messages) ? o.messages : [];
    for (const m of messages) {
      const usage = m.usageMetadata;
      if (!usage) continue;
      const prompt = usage.promptTokenCount ?? 0;
      const cached = usage.cachedContentTokenCount ?? 0;
      const candidates = usage.candidatesTokenCount ?? 0;
      const thoughts = usage.thoughtsTokenCount ?? 0;
      if (!prompt && !candidates && !thoughts) continue;

      entries.push({
        client: id,
        sessionId: o.uuid || path.basename(file, '.json'),
        model: m.model || 'gemini-cli',
        timestamp: m.timestamp ? Date.parse(m.timestamp) : null,
        inputTokens: Math.max(0, prompt - cached),
        outputTokens: candidates + thoughts,
        reasoningTokens: thoughts,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        costUsd: null,
        directory: null,
        title: null,
      });
    }
  }

  return { entries, warnings };
}
