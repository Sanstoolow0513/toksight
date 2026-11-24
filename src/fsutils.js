import { createReadStream } from 'node:fs';
import { opendir, readdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createZstdDecompress } from 'node:zlib';
import { zstdFrameChunks } from './zstd.js';

// Enumerate one level when a collector knows the layout below each project or session.
export async function listDirectory(dir, warnings) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT') warnings.push(`cannot read directory ${dir} (${err.code || err.message})`);
    return [];
  }
}

// Returns { files, warnings }. A root that simply does not exist (ENOENT) is
// silent — the user may not have every agent installed. Anything else
// (EACCES/EPERM, a root that is not a directory, an unreadable subtree)
// yields a warning so "no data" and "cannot read" stay distinguishable.
export async function walkFiles(dir, { maxDepth = 12, filter = () => true } = {}) {
  const out = [];
  const warnings = [];
  async function walk(d, depth) {
    if (depth > maxDepth) return;
    let handle;
    try {
      handle = await opendir(d);
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        warnings.push(`cannot read directory ${d} (${err?.code || err?.message || err})`);
      }
      return;
    }
    try {
      for await (const entry of handle) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
        } else if (entry.isFile() && filter(entry.name)) {
          out.push(full);
        }
      }
    } catch (err) {
      warnings.push(`cannot list directory ${d} (${err?.code || err?.message || err})`);
    }
  }
  await walk(dir, 0);
  out.sort();
  return { files: out, warnings };
}

// Scans several roots and merges the results. Files are looped, not spread,
// into the shared list — `files.push(...found)` hits the ~65k argument limit
// on machines with very large histories.
export async function walkFilesMany(roots, opts = {}) {
  const files = [];
  const warnings = [];
  for (const root of roots) {
    const { files: found, warnings: rootWarnings } = await walkFiles(root, opts);
    for (const f of found) files.push(f);
    for (const w of rootWarnings) warnings.push(w);
  }
  return { files, warnings };
}

// Streams a JSONL file line by line; malformed lines yield `null` objects.
export async function readJsonl(file, handler) {
  const input = createReadStream(file);
  if (file.endsWith('.zst')) {
    await pipeline(input, zstdFrameChunks, createZstdDecompress(), decoded => readJsonLines(decoded, handler));
  } else {
    await readJsonLines(input, handler);
  }
}

async function readJsonLines(input, handler) {
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj = null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      obj = null;
    }
    handler(obj);
  }
}

export async function readJson(file) {
  const text = await readFile(file, 'utf8');
  return JSON.parse(text);
}

export async function pathExists(p) {
  try {
    await opendir(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOTDIR') return true;
    return false;
  }
}
