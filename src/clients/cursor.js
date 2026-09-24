import { stat } from 'node:fs/promises';
import os from 'node:os';

import { databasePath } from '../database.js';
import { selectCursorImports } from '../cursorcsv.js';
import { openSqliteReadOnly } from './sqlite.js';

export const id = 'cursor';
export const label = 'Cursor';

export function sourceRoots({ env = process.env, home = os.homedir() } = {}) {
  return [databasePath({ env, home })];
}

// The web upload stores imported rows in toksight's own SQLite database.
// Reading them here keeps CLI reports and refreshes on the shared pipeline.
export async function collect({ env, home, roots } = {}) {
  const file = (roots ?? sourceRoots({ env, home }))[0];
  const warnings = [];
  try { await stat(file); }
  catch (err) {
    if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') warnings.push(`cursor: cannot read ${file} (${err?.code || err?.message || err})`);
    return { entries: [], warnings };
  }
  let db;
  try {
    db = await openSqliteReadOnly(file);
    const hasIncluded = db.prepare('PRAGMA table_info(cursor_imports)').all().some((column) => column.name === 'included');
    const rows = db.prepare(`SELECT rowid, fingerprint, data_json, reported_cost, ${hasIncluded ? 'included' : '1 AS included'} FROM cursor_imports ORDER BY rowid`).all();
    const selected = selectCursorImports(rows, warnings);
    const entries = selected.map((row) => row.entry);
    const includedCosts = new WeakSet(selected.filter((row) => row.included).map((row) => row.entry));
    return { entries, warnings, includedCosts };
  } catch (err) {
    if (!/no such table: cursor_imports/.test(String(err?.message))) warnings.push(`cursor: database unreadable (${err?.message || err})`);
    return { entries: [], warnings };
  } finally {
    db?.close();
  }
}
