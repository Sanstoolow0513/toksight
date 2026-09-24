// Project-owned SQLite snapshot. Agent files remain read-only; a refresh
// replaces the normalized rows and their pricing provenance in one transaction.

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { computeCost, configDir } from './pricing.js';
import { createPriceLookup } from './pricecatalog.js';
import { selectCursorImports } from './cursorcsv.js';

const SCHEMA_VERSION = 1;
const cursorPriceKey = (model) => `cursor\u0000${model}`;

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
        reported_cost INTEGER NOT NULL CHECK (reported_cost IN (0, 1)),
        included INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS model_prices (
        id INTEGER PRIMARY KEY,
        scope TEXT NOT NULL,
        source TEXT NOT NULL,
        model_id TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT,
        pool TEXT,
        input_usd_per_token REAL NOT NULL,
        cache_read_usd_per_token REAL NOT NULL,
        cache_write_usd_per_token REAL NOT NULL,
        output_usd_per_token REAL NOT NULL,
        cache_read_fallback INTEGER NOT NULL CHECK (cache_read_fallback IN (0, 1)),
        cache_write_fallback INTEGER NOT NULL CHECK (cache_write_fallback IN (0, 1))
      );
      CREATE INDEX IF NOT EXISTS model_prices_model ON model_prices (scope, model_id);
      CREATE TABLE IF NOT EXISTS price_updates (
        source TEXT PRIMARY KEY,
        fetched_at TEXT,
        checked_at TEXT NOT NULL,
        state TEXT NOT NULL,
        url TEXT
      );
    `);
    if (!db.prepare('PRAGMA table_info(cursor_imports)').all().some((column) => column.name === 'included')) {
      // Old imports stored no Cost label. Their null costs were historically
      // treated as Included; preserve that interpretation on migration.
      try { db.exec('ALTER TABLE cursor_imports ADD COLUMN included INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0, 1))'); }
      catch (err) {
        // Another toksight process may have performed the same migration.
        if (!db.prepare('PRAGMA table_info(cursor_imports)').all().some((column) => column.name === 'included')) throw err;
      }
    }
  } catch (err) {
    db.close();
    throw err;
  }

  const getMeta = db.prepare('SELECT * FROM snapshot_meta WHERE id = 1');
  const getEntries = db.prepare('SELECT data_json, reported_cost FROM entries ORDER BY seq');
  const getCursorImports = db.prepare('SELECT rowid, fingerprint, data_json, reported_cost, included FROM cursor_imports ORDER BY rowid');
  const getPrices = db.prepare(`SELECT scope, source, model_id AS modelId, name, provider, pool,
    input_usd_per_token AS input, cache_read_usd_per_token AS cacheRead,
    cache_write_usd_per_token AS cacheWrite, output_usd_per_token AS output,
    cache_read_fallback AS cacheReadFallback, cache_write_fallback AS cacheWriteFallback
    FROM model_prices ORDER BY id`);
  const getPriceUpdates = db.prepare('SELECT source, fetched_at, checked_at, state, url FROM price_updates');
  const deletePriceSource = db.prepare('DELETE FROM model_prices WHERE source = ?');
  const insertPrice = db.prepare(`INSERT INTO model_prices
    (scope, source, model_id, name, provider, pool, input_usd_per_token,
      cache_read_usd_per_token, cache_write_usd_per_token, output_usd_per_token,
      cache_read_fallback, cache_write_fallback)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const putPriceUpdate = db.prepare(`INSERT INTO price_updates (source, fetched_at, checked_at, state, url) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET fetched_at = excluded.fetched_at, checked_at = excluded.checked_at,
      state = excluded.state, url = excluded.url`);
  const insertEntry = db.prepare('INSERT INTO entries (seq, client, timestamp, data_json, reported_cost) VALUES (?, ?, ?, ?, ?)');
  const putCursor = db.prepare(`
    INSERT INTO cursor_imports (fingerprint, data_json, reported_cost, included) VALUES (?, ?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      data_json = excluded.data_json,
      reported_cost = excluded.reported_cost,
      included = excluded.included
  `);
  const touchMeta = db.prepare('UPDATE snapshot_meta SET refreshed_at = ? WHERE id = 1');
  const putCursorPrices = db.prepare('UPDATE snapshot_meta SET model_prices_json = ?, pricing_sources_json = ?, refreshed_at = ? WHERE id = 1');
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
  const getPriceUpdate = db.prepare('SELECT fetched_at FROM price_updates WHERE source = ?');

  function writeCatalog(records, details = {}, checkedAt = new Date().toISOString(), sources = []) {
    const grouped = new Map();
    for (const record of records ?? []) {
      if (!record?.source || !record?.modelId) continue;
      if (!grouped.has(record.source)) grouped.set(record.source, []);
      grouped.get(record.source).push(record);
    }
    for (const source of sources) if (!grouped.has(source)) grouped.set(source, []);
    const skip = new Set();
    for (const [source, rows] of grouped) {
      const incoming = Date.parse(details[source]?.fetchedAt ?? '');
      const previous = Date.parse(getPriceUpdate.get(source)?.fetched_at ?? '');
      if (Number.isFinite(incoming) && Number.isFinite(previous) && incoming < previous) {
        skip.add(source); // A concurrent refresh must not replace newer fetched rates.
        continue;
      }
      deletePriceSource.run(source);
      for (const record of rows) insertPrice.run(record.scope, source, record.modelId, record.name,
        record.provider ?? null, record.pool ?? null, record.input, record.cacheRead,
        record.cacheWrite, record.output, record.cacheReadFallback ? 1 : 0, record.cacheWriteFallback ? 1 : 0);
    }
    for (const [source, detail] of Object.entries(details)) {
      if (skip.has(source)) continue;
      const previous = getPriceUpdate.get(source);
      putPriceUpdate.run(source, detail.fetchedAt ?? previous?.fetched_at ?? null, checkedAt, detail.state, detail.url ?? null);
    }
  }

  function read() {
    const version = db.prepare('PRAGMA data_version').get().data_version;
    if (cached && version === cachedVersion) return cached;
    // Metadata and rows must come from the same committed version if another
    // toksight process refreshes while this one is loading the snapshot.
    db.exec('BEGIN');
    let meta, rows, imports, catalogRows, updateRows;
    try {
      meta = getMeta.get();
      rows = meta ? getEntries.all() : null;
      imports = meta ? getCursorImports.all() : null;
      catalogRows = meta ? getPrices.all() : null;
      updateRows = meta ? getPriceUpdates.all() : null;
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
    const prices = new Map(JSON.parse(meta.model_prices_json));
    const catalog = catalogRows.map((row) => ({ ...row,
      cacheReadFallback: Boolean(row.cacheReadFallback), cacheWriteFallback: Boolean(row.cacheWriteFallback) }));
    const lookup = createPriceLookup(catalog);
    const catalogScopes = new Set(catalog.map((record) => record.scope));
    const priceFor = (model, client) => {
      const scope = client === 'cursor' ? 'cursor' : 'default';
      if (catalogScopes.has(scope)) return lookup(model, client);
      // Old databases have only the per-model snapshot map. It remains a
      // migration fallback until that scope receives a normalized catalog.
      return prices.get(scope === 'cursor' ? cursorPriceKey(model) : model) ?? null;
    };
    const entries = [];
    const reportedCosts = new WeakSet();
    const importWarnings = [];
    for (const row of [...rows, ...selectCursorImports(imports, importWarnings)]) {
      let entry = row.entry ?? JSON.parse(row.data_json);
      if (entry.client === 'cursor' && row.included && entry.costUsd == null) {
        const costUsd = computeCost(entry, priceFor(entry.model, 'cursor'));
        if (costUsd != null) entry = { ...entry, costUsd };
      } else if (entry.client !== 'cursor' && !row.reported_cost) {
        const rate = priceFor(entry.model, entry.client);
        if (rate && ['input', 'cacheRead', 'cacheWrite', 'output'].every((part) => Number.isFinite(rate[part]))) {
          entry = { ...entry, costUsd: computeCost({ ...entry, costUsd: null }, rate) };
        }
      }
      entries.push(entry);
      if (row.reported_cost) reportedCosts.add(entry);
    }
    cached = {
      entries,
      reportedCosts,
      warnings: [...JSON.parse(meta.warnings_json), ...importWarnings],
      pricing: {
        sources: { ...JSON.parse(meta.pricing_sources_json), ...Object.fromEntries(updateRows.map((row) => [row.source, row.state])) },
        configDir: meta.pricing_config_dir,
        priceFor,
        catalog,
        updates: Object.fromEntries(updateRows.map((row) => [row.source, { fetchedAt: row.fetched_at, checkedAt: row.checked_at, state: row.state, url: row.url }])),
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
    const previous = getMeta.get();
    const previousPrices = new Map(previous ? JSON.parse(previous.model_prices_json) : []);
    const sources = { ...raw.pricing.sources };
    const keepPreviousCursorRates = !sources.cursor || sources.cursor === 'unavailable' || sources.cursor.startsWith('skipped');
    let keptPreviousCursorRates = false;
    const prices = new Map();
    for (const entry of scanned) {
      if (!prices.has(entry.model)) prices.set(entry.model, raw.pricing.priceFor(entry.model) ?? null);
    }
    for (const entry of raw.entries) {
      if (entry.client !== 'cursor') continue;
      const key = cursorPriceKey(entry.model);
      let price = raw.pricing.priceFor(entry.model, 'cursor') ?? null;
      if (price == null && keepPreviousCursorRates && previousPrices.has(key)) {
        price = previousPrices.get(key);
        if (price != null) keptPreviousCursorRates = true;
      }
      prices.set(key, price);
    }
    if (keepPreviousCursorRates) {
      for (const [key, price] of previousPrices) {
        if (key.startsWith('cursor\u0000') && !prices.has(key)) {
          prices.set(key, price);
          if (price != null) keptPreviousCursorRates = true;
        }
      }
    }
    if (keptPreviousCursorRates) sources.cursor = 'stale (snapshot)';
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM entries');
      scanned.forEach((entry, i) => {
        insertEntry.run(i, entry.client, entry.timestamp, JSON.stringify(entry), raw.reportedCosts?.has(entry) ? 1 : 0);
      });
      if (raw.pricing.records) {
        const availableSources = ['builtin', 'user'];
        if (raw.pricing.records.some((record) => record.source === 'litellm')) availableSources.push('litellm');
        if (raw.pricing.records.some((record) => record.source === 'cursor')) availableSources.push('cursor');
        writeCatalog(raw.pricing.records, raw.pricing.sourceDetails, refreshedAt, availableSources);
      }
      putMeta.run(
        SCHEMA_VERSION, refreshedAt, scanned.length,
        JSON.stringify(raw.warnings), JSON.stringify(sources),
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

  function writeCursorPrices(cursorPricing, updatedAt) {
    const meta = getMeta.get();
    if (!meta) throw new Error('cannot update Cursor prices before the first snapshot');
    const prices = new Map(JSON.parse(meta.model_prices_json));
    const sources = JSON.parse(meta.pricing_sources_json);
    for (const row of selectCursorImports(getCursorImports.all())) {
      prices.set(cursorPriceKey(row.entry.model), cursorPricing.priceFor(row.entry.model) ?? null);
    }
    if (cursorPricing.records) writeCatalog(cursorPricing.records, cursorPricing.sourceDetails ?? {}, updatedAt, ['cursor']);
    sources.cursor = cursorPricing.state;
    const pricesJson = JSON.stringify([...prices]), sourcesJson = JSON.stringify(sources);
    if (pricesJson === meta.model_prices_json && sourcesJson === meta.pricing_sources_json) return false;
    putCursorPrices.run(pricesJson, sourcesJson, updatedAt);
    return true;
  }

  function updateCursorPricing(cursorPricing, updatedAt = new Date().toISOString()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      writeCursorPrices(cursorPricing, updatedAt);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    cached = null;
    return read();
  }

  function importCursor(records, importedAt = new Date().toISOString(), cursorPricing = null) {
    let imported = 0, duplicates = 0, updated = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = new Map(selectCursorImports(getCursorImports.all()).map((row) => [row.key, row]));
      for (const { key, entry, included = false } of records) {
        const previous = current.get(key);
        if (previous) {
          // A newly reported number can replace Included, and a later numeric
          // charge can correct an earlier numeric one. An older Included CSV
          // must not erase a charge already known for that usage event.
          if ((entry.costUsd == null && (previous.entry.costUsd != null || !included || previous.included)) ||
              (entry.costUsd != null && entry.costUsd === previous.entry.costUsd)) {
            duplicates++;
            continue;
          }
          updated++;
        } else {
          imported++;
        }
        putCursor.run(key, JSON.stringify(entry), entry.costUsd == null ? 0 : 1, included ? 1 : 0);
        current.set(key, { key, entry, reported_cost: entry.costUsd == null ? 0 : 1, included: included ? 1 : 0 });
      }
      const priceChanged = cursorPricing ? writeCursorPrices(cursorPricing, importedAt) : false;
      if ((imported || updated) && !priceChanged) touchMeta.run(importedAt);
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
    hasIncludedCursorUsage: () => selectCursorImports(getCursorImports.all()).some((row) => row.included && !row.reported_cost),
    updateCursorPricing,
    updatePriceCatalog({ records, sourceDetails, sources }, updatedAt = new Date().toISOString()) {
      db.exec('BEGIN IMMEDIATE');
      try {
        writeCatalog(records, sourceDetails, updatedAt, sources);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      cached = null;
      return read();
    },
    importCursor,
    close() {
      if (!closed) db.close();
      closed = true;
    },
  };
}
