// Agent configuration bundling (export) and import (restore) for the web
// dashboard. This is the ONE write path in toksight, and it stays tightly
// scoped:
//
//   export — reads the allowlisted `kind: 'config'` files (credential files
//            are never bundled) into a single JSON bundle document.
//   plan   — validates a bundle against the SAME fixed allowlist and resolves
//            each entry's target path on THIS machine (the bundle's recorded
//            source paths are informational only, never write targets).
//   apply  — backs up any existing target file, then atomically replaces it
//            (temp file + rename). Backups land in
//            <config>/toksight/backups/<agentId>/<fileName>.<timestamp>.
//
// The bundle is plain JSON (text configs travel as strings), so it can be
// saved to a file, copied, pasted and re-imported without any archive tooling
// — and without breaking the zero-runtime-dependency rule. Bundled config
// files contain their SECRETS (that is the point of a migration), so the UI
// warns about safe handling; credential files stay out either way.

import os from 'node:os';
import path from 'node:path';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

import { MAX_READ_BYTES, fileDefs } from './agentconfigs.js';
import { configDir } from './pricing.js';

export const BUNDLE_FORMAT = 'toksight-agent-config-bundle';
export const BUNDLE_VERSION = 1;
// Per-file content cap on import, kept equal to the export-side read cap so a
// bundle can always round-trip what toksight itself produced.
export const MAX_CONTENT_BYTES = MAX_READ_BYTES;

// Skip reasons shared by plan/apply results (mapped to UI text via i18n).
export const SKIP_REASONS = ['secret', 'unknown-id', 'malformed', 'no-content', 'oversize', 'target-not-file', 'not-selected', 'duplicate'];

const pad = (n) => String(n).padStart(2, '0');

// Local-time stamp used in backup file names: YYYYMMDD-HHmmss-SSS.
function timestamp(now = new Date()) {
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds())}`
  );
}

// Backup file names derive from the allowlisted fileName, but sanitize
// defensively anyway — a hostile bundle cannot influence this name (it comes
// from the allowlist), belt and suspenders for the file system.
function sanitizeName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}

function toSetOrNull(value) {
  if (value == null) return null;
  const list = Array.isArray(value) ? value : String(value).split(',');
  const set = new Set(list.map((entry) => String(entry).trim()).filter(Boolean));
  return set.size ? set : null;
}

// ---------------------------------------------------------------------------
// Import

function validateBundleShape(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { error: 'bundle must be a JSON object', files: [] };
  }
  if (bundle.format !== BUNDLE_FORMAT) {
    return { error: `not a ${BUNDLE_FORMAT} document (format: ${JSON.stringify(bundle.format)})`, files: [] };
  }
  if (bundle.version !== BUNDLE_VERSION) {
    return { error: `unsupported bundle version ${JSON.stringify(bundle.version)} (expected ${BUNDLE_VERSION})`, files: [] };
  }
  if (!Array.isArray(bundle.files)) {
    return { error: 'bundle.files must be an array', files: [] };
  }
  return { error: null, files: bundle.files };
}

// Evaluates one bundle entry against the allowlist WITHOUT touching the disk:
// content presence, size cap, and — crucially — that the id maps to a
// non-secret allowlist file. Unknown ids and credential ids never reach the
// write stage, so a bundle cannot write anywhere outside the five agents'
// known config files.
function evalEntry(defById, entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, reason: 'malformed', def: null, content: null };
  }
  if (typeof entry.id !== 'string') return { ok: false, reason: 'malformed', def: null, content: null };
  const def = defById.get(entry.id);
  if (!def) return { ok: false, reason: 'unknown-id', def: null, content: null };
  if (def.kind !== 'config') return { ok: false, reason: 'secret', def: null, content: null };
  if (typeof entry.content !== 'string') return { ok: false, reason: 'no-content', def, content: null };
  if (Buffer.byteLength(entry.content, 'utf8') > MAX_CONTENT_BYTES) {
    return { ok: false, reason: 'oversize', def, content: null };
  }
  return { ok: true, reason: null, def, content: entry.content };
}

export function createAgentTransferService({ env = process.env, home = os.homedir() } = {}) {
  const ctx = { env, home };
  const defs = fileDefs(ctx);
  const defById = new Map(defs.map((def) => [def.id, def]));

  function backupPathFor(def, now = new Date()) {
    return path.join(configDir({ env, home }), 'backups', def.agentId, `${sanitizeName(def.fileName)}.${timestamp(now)}`);
  }

  return {
    // Collects the currently existing allowlisted config files into a bundle.
    // `agents`/`files` are optional id filters (array or comma-separated
    // string); missing files are skipped silently, unreadable or oversized
    // ones are skipped with a warning.
    async exportBundle({ agents, files } = {}) {
      const warnings = [];
      const agentFilter = toSetOrNull(agents);
      const fileFilter = toSetOrNull(files);
      const bundled = [];
      for (const def of defs) {
        if (def.kind !== 'config') continue; // credentials never leave the machine
        if (agentFilter && !agentFilter.has(def.agentId)) continue;
        if (fileFilter && !fileFilter.has(def.id)) continue;

        let info;
        try {
          info = await stat(def.path);
        } catch {
          continue; // not installed / never configured — nothing to bundle
        }
        if (!info.isFile()) {
          warnings.push(`${def.id}: ${def.path} is not a regular file; skipped`);
          continue;
        }
        if (info.size > MAX_READ_BYTES) {
          warnings.push(`${def.id}: ${def.path} is larger than 1 MB; skipped`);
          continue;
        }
        let raw;
        try {
          raw = await readFile(def.path, 'utf8');
        } catch (err) {
          warnings.push(`${def.id}: cannot read ${def.path} (${err?.message || err})`);
          continue;
        }
        bundled.push({
          id: def.id,
          agentId: def.agentId,
          fileName: def.fileName,
          format: def.format,
          path: def.path, // where it lived on THIS machine — reference only
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          content: raw,
        });
      }
      const bundle = {
        format: BUNDLE_FORMAT,
        version: BUNDLE_VERSION,
        createdAt: new Date().toISOString(),
        createdBy: 'toksight',
        files: bundled,
      };
      return { bundle, warnings };
    },

    // Dry run of an import: for every bundle entry reports what import would
    // do on THIS machine — where it would write, whether the target already
    // exists, and where that existing file would be backed up to. Nothing is
    // written. `selected` (optional array of ids) narrows the import set;
    // entries outside it come back as skipped/not-selected.
    async planImport(bundle, { selected } = {}) {
      const { error, files } = validateBundleShape(bundle);
      if (error) return { error, plan: [] };
      const selectedSet = selected == null ? null : new Set(selected.map(String));
      const warnings = [];
      const plan = [];
      const seen = new Set();

      for (const entry of files) {
        const result = evalEntry(defById, entry);
        const id = typeof entry?.id === 'string' ? entry.id : '(missing id)';
        if (seen.has(id)) {
          warnings.push(`${id}: duplicate bundle entry; only the first one is used`);
          continue;
        }
        seen.add(id);

        const def = result.def;
        const included = Boolean(result.ok) && (!selectedSet || selectedSet.has(id));
        const row = {
          id,
          agentId: def ? def.agentId : typeof entry?.agentId === 'string' ? entry.agentId : null,
          fileName: def ? def.fileName : typeof entry?.fileName === 'string' ? entry.fileName : null,
          format: def ? def.format : null,
          contentBytes: result.ok ? Buffer.byteLength(result.content, 'utf8') : null,
          sourcePath: typeof entry?.path === 'string' ? entry.path : null,
          targetPath: null,
          existing: false,
          existingSize: null,
          existingModifiedAt: null,
          backupPath: null,
          action: 'skip',
          reason: result.reason,
        };

        if (result.ok && !included) {
          row.reason = 'not-selected';
          plan.push(row);
          continue;
        }
        if (!result.ok) {
          plan.push(row);
          continue;
        }

        row.targetPath = def.path;
        let info;
        try {
          info = await stat(def.path);
        } catch {
          info = null; // fresh target — plain write, no backup needed
        }
        if (info && !info.isFile()) {
          row.reason = 'target-not-file';
          plan.push(row);
          continue;
        }
        if (info) {
          row.existing = true;
          row.existingSize = info.size;
          row.existingModifiedAt = info.mtime.toISOString();
          row.backupPath = backupPathFor(def);
        }
        row.action = 'write';
        plan.push(row);
      }
      return { error: null, plan, warnings };
    },

    // Executes an import: backs up each existing target file, then atomically
    // replaces it. Per-file failures are reported in the results and never
    // abort the remaining files.
    async applyImport(bundle, { selected } = {}) {
      const { error, files } = validateBundleShape(bundle);
      if (error) return { error, results: [] };
      const selectedSet = selected == null ? null : new Set(selected.map(String));
      const results = [];
      const seen = new Set();

      for (const entry of files) {
        const result = evalEntry(defById, entry);
        const id = typeof entry?.id === 'string' ? entry.id : '(missing id)';
        if (seen.has(id)) continue; // plan already warned; first entry wins
        seen.add(id);

        if (!result.ok) {
          results.push({ id, agentId: entry?.agentId ?? null, status: 'skipped', reason: result.reason, targetPath: null, backupPath: null, error: null });
          continue;
        }
        if (selectedSet && !selectedSet.has(id)) {
          results.push({ id, agentId: result.def.agentId, status: 'skipped', reason: 'not-selected', targetPath: null, backupPath: null, error: null });
          continue;
        }

        const def = result.def;
        try {
          // Backup pass: copy the current file aside before anything touches
          // the target path.
          let backupPath = null;
          let info;
          try {
            info = await stat(def.path);
          } catch {
            info = null;
          }
          if (info) {
            if (!info.isFile()) {
              results.push({ id, agentId: def.agentId, status: 'failed', reason: 'target-not-file', targetPath: def.path, backupPath: null, error: `${def.path} exists and is not a regular file` });
              continue;
            }
            backupPath = backupPathFor(def);
            await mkdir(path.dirname(backupPath), { recursive: true });
            await copyFile(def.path, backupPath);
          }

          // Atomic replace: write a sibling temp file, then rename over the
          // target. A crash mid-write can leave a stray temp file but never a
          // truncated config.
          await mkdir(path.dirname(def.path), { recursive: true });
          const tmp = `${def.path}.toksight-tmp-${randomBytes(4).toString('hex')}`;
          await writeFile(tmp, result.content, 'utf8');
          await rename(tmp, def.path);

          results.push({ id, agentId: def.agentId, status: 'written', reason: null, targetPath: def.path, backupPath, error: null });
        } catch (err) {
          results.push({ id, agentId: def.agentId, status: 'failed', reason: null, targetPath: def.path, backupPath: null, error: String(err?.message || err) });
        }
      }
      return { error: null, results, warnings: [] };
    },
  };
}
