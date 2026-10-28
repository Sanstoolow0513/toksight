// Project-owned SQLite snapshot. Agent files remain read-only; a refresh
// replaces the normalized rows and their pricing provenance in one transaction.

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { computeCost, configDir } from './pricing.js';
import { createPriceLookup, decodePriceRecord, encodePriceMetadata, priceModelKey, storedPriceFor } from './pricecatalog.js';
import { mergeUsageRows } from './usageimports.js';
import { exportDatabaseBytes, readDatabaseBackup } from './dbtransfer.js';
import { PRICE_SOURCES, priceEnabled } from './priceselection.js';
import { installLocalPriceDatabase } from './localpricedb.js';
import { createHistoricalPriceLookup, historyPriceKey } from './pricehistory.js';
import { bindProvider, readProviderBindings } from './providerbindings.js';
import { groupPriceRecords } from './pricegroups.js';

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
      CREATE TABLE IF NOT EXISTS usage_imports (
        fingerprint TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        reported_cost INTEGER NOT NULL CHECK (reported_cost IN (0, 1)),
        price_json TEXT NOT NULL
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
        cache_write_fallback INTEGER NOT NULL CHECK (cache_write_fallback IN (0, 1)),
        metadata_json TEXT NOT NULL DEFAULT 'null'
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
    if (!db.prepare('PRAGMA table_info(model_prices)').all().some((column) => column.name === 'metadata_json')) {
      try { db.exec("ALTER TABLE model_prices ADD COLUMN metadata_json TEXT NOT NULL DEFAULT 'null'"); }
      catch (err) {
        if (!db.prepare('PRAGMA table_info(model_prices)').all().some((column) => column.name === 'metadata_json')) throw err;
      }
    }
    // Older versions stored vendor-page and built-in rates beside LiteLLM. No
    // lookup, export or report reads them any more, so they only duplicated
    // rows; drop them once. User overrides and LiteLLM rows are kept.
    db.exec("DELETE FROM model_prices WHERE source NOT IN ('litellm', 'user')");
  } catch (err) {
    db.close();
    throw err;
  }

  const localPrices = installLocalPriceDatabase(db);
  const getMeta = db.prepare('SELECT * FROM snapshot_meta WHERE id = 1');
  const getEntries = db.prepare('SELECT data_json, reported_cost FROM entries ORDER BY seq');
  const getUsageImports = db.prepare('SELECT * FROM usage_imports ORDER BY rowid');
  const putUsageImport = db.prepare(`INSERT INTO usage_imports (fingerprint, data_json, reported_cost, price_json)
    VALUES (?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET
    data_json = excluded.data_json, reported_cost = excluded.reported_cost, price_json = excluded.price_json`);
  const getPrices = db.prepare(`SELECT scope, source, model_id AS modelId, name, provider, pool,
    input_usd_per_token AS input, cache_read_usd_per_token AS cacheRead,
    cache_write_usd_per_token AS cacheWrite, output_usd_per_token AS output,
    cache_read_fallback AS cacheReadFallback, cache_write_fallback AS cacheWriteFallback, metadata_json AS metadataJson
    FROM model_prices ORDER BY id`);
  const getPriceUpdates = db.prepare('SELECT source, fetched_at, checked_at, state, url FROM price_updates');
  const deletePriceSource = db.prepare('DELETE FROM model_prices WHERE source = ?');
  const insertPrice = db.prepare(`INSERT INTO model_prices
    (scope, source, model_id, name, provider, pool, input_usd_per_token,
      cache_read_usd_per_token, cache_write_usd_per_token, output_usd_per_token,
      cache_read_fallback, cache_write_fallback, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const putPriceUpdate = db.prepare(`INSERT INTO price_updates (source, fetched_at, checked_at, state, url) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET fetched_at = excluded.fetched_at, checked_at = excluded.checked_at,
      state = excluded.state, url = excluded.url`);
  const insertEntry = db.prepare('INSERT INTO entries (seq, client, timestamp, data_json, reported_cost) VALUES (?, ?, ?, ?, ?)');
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
      if (!record?.modelId || !priceEnabled(record, PRICE_SOURCES)) continue;
      if (!grouped.has(record.source)) grouped.set(record.source, []);
      grouped.get(record.source).push(record);
    }
    for (const source of sources) if ((PRICE_SOURCES.includes(source) || source === 'user') && !grouped.has(source)) grouped.set(source, []);
    const skip = new Set();
    for (const [source, rows] of grouped) {
      const incoming = Date.parse(details[source]?.fetchedAt ?? '');
      const previous = Date.parse(getPriceUpdate.get(source)?.fetched_at ?? '');
      if (Number.isFinite(incoming) && Number.isFinite(previous) && incoming < previous) {
        skip.add(source); // A concurrent refresh must not replace newer fetched rates.
        continue;
      }
      deletePriceSource.run(source);
      localPrices.observe(rows, details[source]?.fetchedAt ?? checkedAt);
      for (const record of rows) insertPrice.run(record.scope, source, record.modelId, record.name,
        record.provider ?? null, record.pool ?? null, record.input, record.cacheRead,
        record.cacheWrite, record.output, record.cacheReadFallback ? 1 : 0, record.cacheWriteFallback ? 1 : 0, encodePriceMetadata(record));
    }
    for (const [source, detail] of Object.entries(details)) {
      if (skip.has(source) || !PRICE_SOURCES.includes(source)) continue;
      const previous = getPriceUpdate.get(source);
      putPriceUpdate.run(source, detail.fetchedAt ?? previous?.fetched_at ?? null, checkedAt, detail.state, detail.url ?? null);
    }
  }

  // Catalog IDs that price at least one request in the committed snapshot.
  function usedPriceIds(records, snapshot) {
    const used = new Set();
    if (!snapshot?.entries?.length || !records.length) return used;
    const lookup = createPriceLookup(records);
    const seen = new Set();
    for (const entry of snapshot.entries) {
      const provider = entry.pricingProvider ?? entry.providerId ?? null;
      const probe = JSON.stringify([entry.model, entry.client, provider]);
      if (seen.has(probe)) continue;
      seen.add(probe);
      const rate = lookup(entry.model, entry.client, { pricingProvider: entry.pricingProvider, providerId: entry.providerId });
      if (rate) used.add(historyPriceKey(rate));
    }
    return used;
  }

  function read() {
    const version = db.prepare('PRAGMA data_version').get().data_version;
    if (cached && version === cachedVersion) return cached;
    // Metadata and rows must come from the same committed version if another
    // toksight process refreshes while this one is loading the snapshot.
    db.exec('BEGIN');
    let meta, rows, usageImports, catalogRows, updateRows, history, selectedSources;
    try {
      meta = getMeta.get();
      rows = meta ? getEntries.all() : null;
      usageImports = meta ? getUsageImports.all() : null;
      catalogRows = meta ? getPrices.all() : null;
      updateRows = meta ? getPriceUpdates.all() : null;
      selectedSources = localPrices.status().selectedSources;
      history = meta ? localPrices.read().filter((row) => priceEnabled(JSON.parse(row.record_json), selectedSources)) : [];
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
    const prices = new Map(JSON.parse(meta.model_prices_json).filter(([key, rate]) => !key.startsWith('cursor\u0000') && priceEnabled(rate, selectedSources)));
    for (const row of usageImports) {
      const entry = JSON.parse(row.data_json);
      if (entry.client === 'cursor') continue;
      const rate = JSON.parse(row.price_json);
      if (!prices.get(entry.model) && priceEnabled(rate, selectedSources)) prices.set(entry.model, rate);
    }
    const catalog = catalogRows.filter((row) => row.scope === 'default' && priceEnabled(row, selectedSources)).map(decodePriceRecord).map((row) => ({ ...row,
      cacheReadFallback: Boolean(row.cacheReadFallback), cacheWriteFallback: Boolean(row.cacheWriteFallback) }));
    const lookup = createHistoricalPriceLookup(history, catalog);
    const priceFor = (model, client, entry = null) => {
      // Imported and legacy models retain a fallback when the destination
      // has no current catalog rate for that model.
      const fallback = prices.get(model);
      return lookup(model, client, entry) ?? (priceEnabled(fallback, selectedSources) ? storedPriceFor(model, fallback, entry) : null);
    };
    const entries = [];
    const reportedCosts = new WeakSet();
    const importWarnings = [];
    const bindings = readProviderBindings({ env, home }, importWarnings);
    for (const row of mergeUsageRows(rows, usageImports)) {
      let entry = row.entry ?? JSON.parse(row.data_json);
      if (entry.client === 'cursor') continue;
      entry = bindProvider(entry, bindings);
      if (!row.reported_cost) {
        const rate = priceFor(entry.model, entry.client, entry);
        if (rate && ['input', 'cacheRead', 'cacheWrite', 'output'].every((part) => Number.isFinite(rate[part]))) {
          entry = { ...entry, costUsd: computeCost({ ...entry, costUsd: null }, rate) };
        } else if (!rate) {
          entry = { ...entry, costUsd: null };
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
        sources: { ...Object.fromEntries(Object.entries(JSON.parse(meta.pricing_sources_json)).filter(([source]) => (PRICE_SOURCES.includes(source) || source === 'user'))),
          ...Object.fromEntries(updateRows.filter((row) => priceEnabled(row, selectedSources)).map((row) => [row.source, row.state])),
          ...Object.fromEntries(PRICE_SOURCES.filter((source) => !selectedSources.includes(source)).map((source) => [source, 'disabled'])) },
        configDir: meta.pricing_config_dir,
        priceFor,
        catalog,
        updates: Object.fromEntries(updateRows.filter((row) => priceEnabled(row, selectedSources)).map((row) => [row.source, { fetchedAt: row.fetched_at, checkedAt: row.checked_at, state: row.state, url: row.url }])),
      },
      refreshedAt: meta.refreshed_at,
    };
    cachedVersion = version;
    return cached;
  }

  function replace(raw, refreshedAt = new Date().toISOString()) {
    const scanned = raw.entries.filter((entry) => entry.client !== 'cursor');
    const sources = Object.fromEntries(Object.entries(raw.pricing.sources).filter(([source]) => PRICE_SOURCES.includes(source) || source === 'user'));
    const prices = new Map();
    for (const entry of scanned) {
      if (prices.has(entry.model)) continue;
      const rate = raw.pricing.priceFor(entry.model, entry.client);
      prices.set(entry.model, priceEnabled(rate, PRICE_SOURCES) ? rate : null);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM entries');
      scanned.forEach((entry, i) => {
        insertEntry.run(i, entry.client, entry.timestamp, JSON.stringify(entry), raw.reportedCosts?.has(entry) ? 1 : 0);
      });
      if (raw.pricing.records) {
        const availableSources = [...new Set(['user', ...raw.pricing.records.map((record) => record.source)])];
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

  function importDatabase(bytes, importedAt = new Date().toISOString()) {
    const backup = readDatabaseBackup(bytes); // Validate completely before writing.
    let imported = 0, duplicates = 0, updated = 0, latestAt = null;
    const backupPrices = new Map(backup.prices);
    const backupLookup = createPriceLookup(backup.catalog);
    db.exec('BEGIN IMMEDIATE');
    try {
      localPrices.import(backup.history ?? []);
      const current = new Map(mergeUsageRows(getEntries.all(), getUsageImports.all()).map((r) => [r.fingerprint, r]));
      for (const row of backup.rows) {
        const previous = current.get(row.fingerprint);
        const useIncoming = !previous || (row.reported_cost && !previous.reported_cost);
        if (!previous) imported++;
        else if (useIncoming) updated++;
        else duplicates++;
        const selected = useIncoming ? row : previous;
        const entry = selected.entry ?? JSON.parse(selected.data_json);
        // Even rows already present locally become durable imported history.
        const rate = backupLookup(entry.model, entry.client) ?? backupPrices.get(entry.model) ?? row.price ?? null;
        putUsageImport.run(row.fingerprint, JSON.stringify(entry), selected.reported_cost, selected.price_json ?? JSON.stringify(rate));
        if (row.entry.timestamp != null) latestAt = Math.max(latestAt ?? row.entry.timestamp, row.entry.timestamp);
      }
      // Existing rates win conflicts; missing first-party rates travel with
      // the backup. No agent configuration or local overrides are written.
      const priceKey = (row) => JSON.stringify([row.scope, priceModelKey(row.name)]);
      const existingPrices = new Set(getPrices.all().filter((row) => priceEnabled(row, PRICE_SOURCES)).map(priceKey));
      for (const row of backup.catalog) {
        if (existingPrices.has(priceKey(row))) continue;
        insertPrice.run(row.scope, row.source, row.modelId, row.name, row.provider, row.pool,
          row.input, row.cacheRead, row.cacheWrite, row.output, row.cacheReadFallback, row.cacheWriteFallback, encodePriceMetadata(row));
      }
      const existingUpdates = new Set(getPriceUpdates.all().map((r) => r.source));
      for (const row of backup.updates) {
        if (!existingUpdates.has(row.source)) putPriceUpdate.run(row.source, row.fetched_at, row.checked_at, row.state, row.url);
      }
      const previous = getMeta.get();
      const prices = new Map([...backup.prices, ...(previous ? JSON.parse(previous.model_prices_json) : [])]
        .filter(([key, rate]) => !key.startsWith('cursor\u0000') && priceEnabled(rate, PRICE_SOURCES)));
      // Keep a per-model fallback even if an offline pricing check has no
      // downloaded catalog on the destination machine.
      for (const row of backup.rows) {
        const key = row.entry.model;
        if (!prices.get(key)) {
          const rate = backupLookup(row.entry.model, row.entry.client) ?? row.price ?? null;
          if (priceEnabled(rate, PRICE_SOURCES)) prices.set(key, rate);
        }
      }
      putMeta.run(SCHEMA_VERSION, importedAt, getEntries.all().length,
        JSON.stringify([...new Set([...JSON.parse(backup.meta.warnings_json), ...(previous ? JSON.parse(previous.warnings_json) : [])])]),
        JSON.stringify(Object.fromEntries(Object.entries({ ...JSON.parse(backup.meta.pricing_sources_json), ...(previous ? JSON.parse(previous.pricing_sources_json) : {}) })
          .filter(([source]) => PRICE_SOURCES.includes(source) || source === 'user'))),
        previous?.pricing_config_dir ?? path.dirname(filename), JSON.stringify([...prices]));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    cached = null;
    return { imported, duplicates, updated, latestAt, entries: read().entries.length };
  }

  return {
    file: filename,
    read,
    replace,
    resetPrices() {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(`
          DELETE FROM model_prices;
          DELETE FROM price_updates;
          DELETE FROM price_history;
          DELETE FROM web_setup;
          UPDATE snapshot_meta SET model_prices_json = '[]', pricing_sources_json = '{}';
          UPDATE usage_imports SET price_json = 'null';
        `);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      cached = null;
      return localPrices.status();
    },
    priceStatus: () => localPrices.status(),
    priceCatalog(key = null) {
      // Read only committed price data, without collecting usage or downloading.
      let snapshot = null;
      if (key == null) {
        try { snapshot = read(); } catch { snapshot = null; }
      }
      db.exec('BEGIN');
      try {
        const status = localPrices.status();
        let result;
        if (key != null) result = { key, history: localPrices.history(key), status };
        else {
          const history = new Map(localPrices.summary().map((row) => [row.price_key, row]));
          const records = getPrices.all().filter((record) => record.scope === 'default' && priceEnabled(record, status.selectedSources)).map(decodePriceRecord).map((record) => {
            const id = historyPriceKey(record), summary = history.get(id);
            return { ...record, cacheReadFallback: Boolean(record.cacheReadFallback), cacheWriteFallback: Boolean(record.cacheWriteFallback),
              id, revisions: summary?.revisions ?? 0, observedAt: summary?.observedAt ?? null };
          });
          const updates = Object.fromEntries(getPriceUpdates.all().filter((row) => priceEnabled(row, status.selectedSources)).map((row) => [row.source,
            { fetchedAt: row.fetched_at, checkedAt: row.checked_at, state: row.state, url: row.url }]));
          result = { records, updates, status, models: groupPriceRecords(records, usedPriceIds(records, snapshot)) };
        }
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    selectPriceSources(sources) { localPrices.selectSources(sources); cached = null; },
    completeSetup: (options, at) => localPrices.complete(options, at),
    exportDatabase: () => {
      if (!read()) throw new Error('No usage snapshot; run toksight refresh first');
      return exportDatabaseBytes(db);
    },
    importDatabase,
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
    close() {
      if (!closed) db.close();
      closed = true;
    },
  };
}
