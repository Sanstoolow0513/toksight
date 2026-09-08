import os from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { parseToml } from '../toml.js';
import { stripJsonc } from './parse.js';
import { PREVIEW_BYTES, MAX_READ_BYTES, AGENTS } from './limits.js';
import { redactConfig } from './redact.js';
import { fileDefs } from './files.js';
import { SUMMARIZERS, normalizeSummary } from './summaries.js';

// ---------------------------------------------------------------------------
// Per-file inspection
//
// The `file` objects below carry a `kind` field (straight from the allowlist,
// 'config' | 'secret') — the authoritative classification the dashboard now
// filters on. The older `previewable` boolean is kept for payload
// compatibility only (false = secret OR any error state, so its meaning has
// drifted from `kind`); treat it as deprecated in favor of `kind`.

function missingFile(def) {
  return {
    file: {
      id: def.id, agentId: def.agentId, label: def.label, fileName: def.fileName,
      format: def.format, kind: def.kind, path: def.path, exists: false, size: 0, modifiedAt: null,
      previewable: def.kind !== 'secret', preview: null, truncated: false, error: null,
    },
    data: { exists: false },
  };
}

async function inspectOne(def, warnings) {
  let info;
  try {
    info = await stat(def.path);
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return missingFile(def);
    warnings.push(`${def.agentId}: cannot inspect ${def.path} (${err?.message || err})`);
    const base = missingFile(def);
    return { file: { ...base.file, exists: true, error: String(err?.message || err), previewable: false }, data: base.data };
  }
  if (!info.isFile()) {
    warnings.push(`${def.agentId}: ${def.path} is not a regular file`);
    const base = missingFile(def);
    return { file: { ...base.file, exists: true, error: 'not a regular file', previewable: false }, data: base.data };
  }

  const file = {
    id: def.id, agentId: def.agentId, label: def.label, fileName: def.fileName,
    format: def.format, kind: def.kind, path: def.path, exists: true, size: info.size,
    modifiedAt: info.mtime.toISOString(), truncated: info.size > PREVIEW_BYTES, error: null,
  };
  const data = { exists: true };

  if (info.size > MAX_READ_BYTES) {
    warnings.push(`${def.agentId}: ${def.path} is larger than 1 MB; only metadata is shown`);
    file.previewable = def.kind !== 'secret';
    file.preview = null;
    return { file, data };
  }

  let raw;
  try {
    raw = await readFile(def.path, 'utf8');
  } catch (err) {
    warnings.push(`${def.agentId}: cannot read ${def.path} (${err?.message || err})`);
    file.error = String(err?.message || err);
    file.previewable = false;
    return { file, data };
  }

  if (def.kind === 'secret') {
    file.previewable = false;
    file.preview = null;
    if (def.extract) {
      try {
        data.extract = def.extract(raw);
      } catch (err) {
        warnings.push(`${def.agentId}: cannot parse ${def.path} (${err?.message || err})`);
      }
    }
    return { file, data };
  }

  file.previewable = true;
  const safe = Buffer.from(redactConfig(raw, def.format));
  file.preview = safe.subarray(0, PREVIEW_BYTES).toString('utf8');
  file.truncated = safe.length > PREVIEW_BYTES;

  if (def.format === 'json' || def.format === 'jsonc') {
    try {
      data.parsed = JSON.parse(def.format === 'jsonc' ? stripJsonc(raw) : raw);
    } catch {
      warnings.push(`${def.agentId}: cannot parse ${def.path}`);
    }
  } else if (def.format === 'toml') {
    const { value, error } = parseToml(raw);
    data.parsed = value;
    if (error) warnings.push(`${def.agentId}: ${def.path}: ${error}`);
  } else {
    data.raw = raw;
  }
  return { file, data };
}

export function createAgentConfigService({ env = process.env, home = os.homedir() } = {}) {
  const ctx = { env, home };
  const defs = fileDefs(ctx);

  return {
    async inspect() {
      const warnings = [];
      const agents = [];
      for (const agent of AGENTS) {
        const files = [];
        const data = new Map();
        for (const def of defs.filter((entry) => entry.agentId === agent.id)) {
          try {
            const { file, data: fileData } = await inspectOne(def, warnings);
            files.push(file);
            data.set(def.id, fileData);
          } catch (err) {
            warnings.push(`${agent.id}: cannot inspect ${def.path} (${err?.message || err})`);
            files.push({ ...missingFile(def).file, exists: true, error: String(err?.message || err), previewable: false });
          }
        }

        let summary = { defaultModel: null, auth: null, facts: [], providers: [], models: [], mcpServers: [] };
        try {
          summary = normalizeSummary(await SUMMARIZERS[agent.id]({ data, env, home }));
        } catch (err) {
          warnings.push(`${agent.id}: cannot summarize configuration (${err?.message || err})`);
        }
        agents.push({ id: agent.id, label: agent.label, files, summary });
      }
      return { agents, warnings };
    },
  };
}
