import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createUsageDatabase } from './database.js';
import { MAX_DATABASE_BYTES } from './dbtransfer.js';

export async function runDatabaseTransfer(opts, context = {}) {
  const database = createUsageDatabase(context);
  try {
    const file = path.resolve(opts.file);
    if (opts.command === 'export-db') {
      const bytes = database.exportDatabase();
      // Existing files, including the live DB and its WAL, are never replaced.
      await writeFile(file, bytes, { flag: 'wx' });
      return { file, bytes: bytes.length, entries: database.read().entries.length };
    }
    if ((await stat(file)).size > MAX_DATABASE_BYTES) throw new Error('Database is larger than 256 MB');
    return { file, ...database.importDatabase(await readFile(file)) };
  } finally { database.close(); }
}
