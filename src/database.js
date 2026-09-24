// Project-owned SQLite snapshot. Agent files remain read-only; a refresh
// replaces the normalized rows and their pricing provenance in one transaction.

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { configDir } from './pricing.js';
import { selectCursorImports } from './cursorcsv.js';

const SCHEMA_VERSION = 1;

export function databasePath({ env = process.env, home = os.homedir() } = {}) {
  return path.join(configDir({ env, home }), 'usage.sqlite');
}

export function createUsageDatabase({ file, env, home } = {}) {
  const filename = file === ':memory:' ? file : path.resolve(file ?? databasePath({ env, home }));
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000');
    db.exec(`
      CREATE TABLE IF NOT EXISTS snapshot_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        refreshed_at TEXT NOT NULL,
        entry_count INTEGER NOT NULL,
        warnings_json TEXT NOT NULL,
        pricing_sources_json TEXT NOT NULL,
        pricing_config_dir TEXT NOT NULL,
        model_prices_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entries (
        seq INTEGER PRIMARY KEY,
        client TEXT NOT NULL,
        timestamp INTEGER,
        data_json TEXT NOT NULL,
        reported_cost INTEGER NOT NULL CHECK (reported_cost IN (0, 1))
      );
      CREATE INDEX IF NOT EXISTS entries_client_timestamp ON entries (client, timestamp);
      CREATE TABLE IF NOT EXISTS cursor_imports (
        fingerprint TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        reported_cost INTEGER NOT NULL CHECK (reported_cost IN (0, 1))
      );
    `);
  } catch (err) {
    db.close();
    throw err;
  }

  const getMeta = db.prepare('SELECT * FROM snapshot_meta WHERE id = 1');
  const getEntries = db.prepare('SELECT data_json, reported_cost FROM entries ORDER BY seq');
  const getCursorImports = db.prepare('SELECT rowid, fingerprint, data_json, reported_cost FROM cursor_imports ORDER BY rowid');
  const insertEntry = db.prepare('INSERT INTO entries (seq, client, timestamp, data_json, reported_cost) VALUES (?, ?, ?, ?, ?)');
  const putCursor = db.prepare(`
    INSERT INTO cursor_imports (fingerprint, data_json, reported_cost) VALUES (?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      data_json = excluded.data_json,
      reported_cost = excluded.reported_cost
  `);
  const touchMeta = db.prepare('UPDATE snapshot_meta SET refreshed_at = ? WHERE id = 1');
  const putMeta = db.prepare(`
    INSERT INTO snapshot_meta (id, schema_version, refreshed_at, entry_count, warnings_json, pricing_sources_json, pricing_config_dir, model_prices_json)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      schema_version = excluded.schema_version,
      refreshed_at = excluded.refreshed_at,
      entry_count = excluded.entry_count,
      warnings_json = excluded.warnings_json,
      pricing_sources_json = excluded.pricing_sources_json,
      pricing_config_dir = excluded.pricing_config_dir,
      model_prices_json = excluded.model_prices_json
  `);
  let cached = null;
  let cachedVersion = null;
  let closed = false;

  function read() {
    const version = db.prepare('PRAGMA data_version').get().data_version;
    if (cached && version === cachedVersion) return cached;
    // Metadata and rows must come from the same committed version if another
    // toksight process refreshes while this one is loading the snapshot.
    db.exec('BEGIN');
    let meta, rows, imports;
    try {
      meta = getMeta.get();
      rows = meta ? getEntries.all() : null;
      imports = meta ? getCursorImports.all() : null;
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    if (!meta) return null;
    if (meta.schema_version !== SCHEMA_VERSION) {
      throw new Error(`unsupported toksight database schema ${meta.schema_version}; expected ${SCHEMA_VERSION}`);
    }
    if (rows.length !== meta.entry_count) throw new Error('toksight database snapshot is incomplete');
    const entries = [];
    const reportedCosts = new WeakSet();
    const importWarnings = [];
    for (const row of [...rows, ...selectCursorImports(imports, importWarnings)]) {
      const entry = row.entry ?? JSON.parse(row.data_json);
      entries.push(entry);
      if (row.reported_cost) reportedCosts.add(entry);
    }
    const prices = new Map(JSON.parse(meta.model_prices_json));
    cached = {
      entries,
      reportedCosts,
      warnings: [...JSON.parse(meta.warnings_json), ...importWarnings],
      pricing: {
        sources: JSON.parse(meta.pricing_sources_json),
        configDir: meta.pricing_config_dir,
        priceFor: (model) => prices.get(model) ?? null,
      },
      refreshedAt: meta.refreshed_at,
    };
    cachedVersion = version;
    return cached;
  }

  function replace(raw, refreshedAt = new Date().toISOString()) {
    // Cursor imports have their own durable table. The collection pipeline
    // reads them for CLI reports, while the snapshot references them directly
    // so importing and refreshing can never count them twice.
    const scanned = raw.entries.filter((entry) => entry.client !== 'cursor');
    const prices = new Map();
    for (const entry of scanned) {
      if (!prices.has(entry.model)) prices.set(entry.model, raw.pricing.priceFor(entry.model) ?? null);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM entries');
      scanned.forEach((entry, i) => {
        insertEntry.run(i, entry.client, entry.timestamp, JSON.stringify(entry), raw.reportedCosts?.has(entry) ? 1 : 0);
      });
      putMeta.run(
        SCHEMA_VERSION, refreshedAt, scanned.length,
        JSON.stringify(raw.warnings), JSON.stringify(raw.pricing.sources),
        raw.pricing.configDir, JSON.stringify([...prices]),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    cached = null;
    return read();
  }

  function importCursor(records, importedAt = new Date().toISOString()) {
    let imported = 0, duplicates = 0, updated = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = new Map(selectCursorImports(getCursorImports.all()).map((row) => [row.key, row]));
      for (const { key, entry } of records) {
        const previous = current.get(key);
        if (previous) {
          // A newly reported number can replace Included, and a later numeric
          // charge can correct an earlier numeric one. An older Included CSV
          // must not erase a charge already known for that usage event.
          if (entry.costUsd == null || entry.costUsd === previous.entry.costUsd) {
            duplicates++;
            continue;
          }
          updated++;
        } else {
          imported++;
        }
        putCursor.run(key, JSON.stringify(entry), entry.costUsd == null ? 0 : 1);
        current.set(key, { key, entry, reported_cost: entry.costUsd == null ? 0 : 1 });
      }
      if (imported || updated) touchMeta.run(importedAt);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    cached = null;
    return { imported, duplicates, updated, snapshot: read() };
  }

  return {
    file: filename,
    read,
    replace,
    importCursor,
    close() {
      if (!closed) db.close();
      closed = true;
    },
  };
}
