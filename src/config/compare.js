import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { MAX_READ_BYTES, PREVIEW_BYTES } from './limits.js';
import { redactConfig } from './redact.js';
import { stripJsonc } from './parse.js';
import { parseToml } from '../toml.js';

export function revision(content) {
  return content === null ? 'missing' : createHash('sha256').update(content).digest('hex');
}

// One disk check for preview and apply; unreadable targets are never treated as new.
export async function inspectTarget(def) {
  let existing;
  try { existing = await lstat(def.path); }
  catch (err) {
    if (err.code === 'ENOENT') return { existing: null, content: null, revision: 'missing' };
    return { reason: err.code === 'ENOTDIR' ? 'target-not-file' : 'target-unreadable' };
  }
  if (!existing.isFile()) return { existing, reason: 'target-not-file' };
  if (existing.size > MAX_READ_BYTES) return { existing, reason: 'target-oversize' };
  try {
    const bytes = await readFile(def.path);
    if (bytes.length > MAX_READ_BYTES) return { existing, reason: 'target-oversize' };
    return { existing, content: bytes.toString('utf8'), revision: revision(bytes) };
  } catch { return { existing, reason: 'target-unreadable' }; }
}

function preview(content, format) {
  // Redact the complete value before truncating: cutting JSON first loses its key context.
  const safe = Buffer.from(redactConfig(content ?? '', format));
  const text = safe.subarray(0, PREVIEW_BYTES).toString('utf8');
  const lines = text === '' ? [] : text.split(/\r?\n/);
  return { lines: lines.slice(0, 600), truncated: safe.length > PREVIEW_BYTES || lines.length > 600 };
}

// Bounded LCS for normal configs; large edits fall back to a replacement block.
function diffLines(before, after) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > prefix && endAfter > prefix && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  const rows = before.slice(0, prefix).map((text) => ({ kind: 'equal', text }));
  const a = before.slice(prefix, endBefore), b = after.slice(prefix, endAfter);
  if (a.length * b.length > 160000) {
    rows.push(...a.map((text) => ({ kind: 'remove', text })), ...b.map((text) => ({ kind: 'add', text })));
  } else {
    const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { rows.push({ kind: 'equal', text: a[i++] }); j++; }
      else if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1])) rows.push({ kind: 'remove', text: a[i++] });
      else rows.push({ kind: 'add', text: b[j++] });
    }
  }
  rows.push(...before.slice(endBefore).map((text) => ({ kind: 'equal', text })));
  return rows;
}

export function compareConfig(before, after, format) {
  const a = preview(before, format), b = preview(after, format);
  const lines = diffLines(a.lines, b.lines);
  return {
    lines,
    truncated: a.truncated || b.truncated,
    hiddenChanges: before !== after && !lines.some((line) => line.kind !== 'equal'),
  };
}

// Advisory categories only: never echo potentially sensitive matched values.
export function migrationNotes(content, format) {
  const notes = [];
  try {
    if (format === 'json' || format === 'jsonc') JSON.parse(format === 'jsonc' ? stripJsonc(content) : content);
    else if (format === 'toml' && parseToml(content).error) notes.push('invalid-format');
  } catch { notes.push('invalid-format'); }
  if (/["'](?:\/(?!\/)|[A-Za-z]:[\\/])/.test(content)) notes.push('absolute-paths');
  if (/\$\{?[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|\benv_key\b/.test(content)) notes.push('env-references');
  if (/["']?command["']?\s*[:=]/i.test(content)) notes.push('external-commands');
  return notes;
}
