import { createReadStream } from 'node:fs';
import { opendir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';

export async function walkFiles(dir, { maxDepth = 12, filter = () => true } = {}) {
  const out = [];
  async function walk(d, depth) {
    if (depth > maxDepth) return;
    let handle;
    try {
      handle = await opendir(d);
    } catch {
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
    } catch {
      // unreadable subtree: skip it
    }
  }
  await walk(dir, 0);
  return out.sort();
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
