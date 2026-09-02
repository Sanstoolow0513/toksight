import { createReadStream } from 'node:fs';
import { opendir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';

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

// Streams a JSONL file line by line; malformed lines yield `null` objects.
export async function readJsonl(file, handler) {
  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
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
