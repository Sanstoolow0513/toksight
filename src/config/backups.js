import path from 'node:path';
import { copyFile, lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { MAX_READ_BYTES } from './limits.js';

const pad = (n, width = 2) => String(n).padStart(width, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
const safeName = (name) => String(name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
const STAMP = /^\d{8}-\d{6}-\d{3}(?:-[a-f0-9]{12})?$/;

export function createBackupStore({ root, defs }) {
  const configs = defs.filter((def) => def.kind === 'config');
  const agentIds = [...new Set(configs.map((def) => def.agentId))];

  async function directory(dir, create = false) {
    if (create) await mkdir(dir, { recursive: true });
    const info = await lstat(dir);
    if (!info.isDirectory()) throw new Error('Backup directory must be a regular directory (symlinks are refused)');
  }

  function resolveName(agentId, name) {
    if (!agentIds.includes(agentId) || name !== path.basename(name) || name.includes('\\')) return null;
    const candidates = configs.filter((def) => def.agentId === agentId);
    const current = candidates.filter((def) => {
      const prefix = `${safeName(def.fileName)}.${def.id}.`;
      return name.startsWith(prefix) && STAMP.test(name.slice(prefix.length));
    });
    if (current.length === 1) return current[0];
    const legacy = candidates.filter((def) => {
      const prefix = `${safeName(def.fileName)}.`;
      return name.startsWith(prefix) && STAMP.test(name.slice(prefix.length));
    });
    // Old ZCode backups share the name config.json: never guess their destination.
    return legacy.length === 1 ? legacy[0] : null;
  }

  return {
    pathFor(def) {
      return path.join(root, def.agentId, `${safeName(def.fileName)}.${def.id}.${stamp(new Date())}-${randomBytes(6).toString('hex')}`);
    },
    async save(def, target) {
      await directory(root, true);
      await directory(path.join(root, def.agentId), true);
      await copyFile(def.path, target, constants.COPYFILE_EXCL);
    },
    async list() {
      const backups = [], warnings = [];
      try { await directory(root); }
      catch (err) {
        if (err.code !== 'ENOENT') warnings.push('Cannot read the backup directory; no backups were listed.');
        return { backups, warnings };
      }
      for (const agentId of agentIds) {
        const dir = path.join(root, agentId);
        try {
          await directory(dir);
          for (const name of await readdir(dir)) {
            const def = resolveName(agentId, name);
            if (!def) { warnings.push(`${agentId}: an unrecognized or ambiguous backup was omitted.`); continue; }
            const file = path.join(dir, name);
            const info = await lstat(file);
            if (!info.isFile() || info.size > MAX_READ_BYTES) { warnings.push(`${def.id}: a non-regular or oversized backup was omitted.`); continue; }
            backups.push({ backupId: `${agentId}/${name}`, fileId: def.id, agentId, fileName: def.fileName, path: file, size: info.size, createdAt: info.mtime.toISOString() });
          }
        } catch (err) {
          if (err.code !== 'ENOENT') warnings.push(`${agentId}: cannot read backups.`);
        }
      }
      backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.backupId.localeCompare(a.backupId));
      if (backups.length > 200) warnings.push('Only the 200 most recent backups are listed.');
      return { backups: backups.slice(0, 200), warnings: [...new Set(warnings)] };
    },
    async read(backupId) {
      if (typeof backupId !== 'string') throw new Error('Invalid backup id');
      const parts = backupId.split('/');
      const def = parts.length === 2 ? resolveName(parts[0], parts[1]) : null;
      if (!def) throw new Error('Unknown or ambiguous backup');
      await directory(root);
      await directory(path.join(root, def.agentId));
      const file = path.join(root, ...parts);
      const info = await lstat(file);
      if (!info.isFile() || info.size > MAX_READ_BYTES) throw new Error('Backup is not a regular file or exceeds 1 MB');
      const content = await readFile(file, 'utf8');
      if (Buffer.byteLength(content) > MAX_READ_BYTES) throw new Error('Backup exceeds 1 MB');
      return { id: def.id, content };
    },
  };
}
