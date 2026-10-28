import { PRICE_SOURCES, priceEnabled, readPriceSources, validPriceSources } from './priceselection.js';
import { historyPriceKey, priceSignature } from './pricehistory.js';

// These tables live in toksight's existing database and share its transactions.
export function installLocalPriceDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      price_key TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      signature TEXT NOT NULL,
      record_json TEXT NOT NULL,
      PRIMARY KEY (price_key, observed_at)
    );
    CREATE TABLE IF NOT EXISTS price_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1), sources_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS web_setup (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      completed_at TEXT NOT NULL,
      auto_update INTEGER NOT NULL CHECK (auto_update IN (0, 1))
    );
  `);
  const latest = db.prepare('SELECT observed_at, signature FROM price_history WHERE price_key = ? ORDER BY observed_at DESC LIMIT 1');
  const insert = db.prepare(`INSERT INTO price_history (price_key, observed_at, signature, record_json) VALUES (?, ?, ?, ?)
    ON CONFLICT(price_key, observed_at) DO UPDATE SET signature = excluded.signature, record_json = excluded.record_json`);
  const read = db.prepare('SELECT * FROM price_history ORDER BY observed_at, price_key');
  const setup = db.prepare('SELECT * FROM web_setup WHERE id = 1');
  const activeHistory = () => {
    const sources = readPriceSources(db);
    return read.all().filter((row) => priceEnabled(JSON.parse(row.record_json), sources));
  };
  return {
    observe(records, at) {
      for (const record of records) {
        if (record.source !== 'litellm' || !priceEnabled(record, PRICE_SOURCES)) continue;
        const key = historyPriceKey(record), signature = priceSignature(record), previous = latest.get(key);
        if (previous && (at < previous.observed_at || signature === previous.signature)) continue;
        insert.run(key, at, signature, JSON.stringify(record));
      }
    },
    read: activeHistory,
    summary() {
      const result = new Map();
      for (const row of activeHistory()) {
        const previous = result.get(row.price_key);
        result.set(row.price_key, { price_key: row.price_key, revisions: (previous?.revisions ?? 0) + 1, observedAt: row.observed_at });
      }
      return [...result.values()];
    },
    history: (key) => activeHistory().filter((row) => row.price_key === key).reverse()
      .map((row) => ({ observedAt: row.observed_at, record: JSON.parse(row.record_json) })),
    status() {
      const row = setup.get();
      const history = activeHistory();
      return { selectedSources: readPriceSources(db), completed: Boolean(row), completedAt: row?.completed_at ?? null, autoUpdate: row ? Boolean(row.auto_update) : true,
        revisions: history.length, prices: new Set(history.map((r) => r.price_key)).size, observedAt: history.at(-1)?.observed_at ?? null };
    },
    selectSources(sources) {
      if (!validPriceSources(sources)) throw new Error('invalid price sources');
      db.prepare('INSERT INTO price_preferences (id, sources_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET sources_json = excluded.sources_json').run(JSON.stringify(sources));
    },
    complete({ autoUpdate = true } = {}, at = new Date().toISOString()) {
      db.prepare(`INSERT INTO web_setup (id, completed_at, auto_update) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET auto_update = excluded.auto_update`).run(at, autoUpdate ? 1 : 0);
      return this.status();
    },
    import(rows) {
      const put = db.prepare('INSERT OR IGNORE INTO price_history (price_key, observed_at, signature, record_json) VALUES (?, ?, ?, ?)');
      for (const row of rows) {
        if (priceEnabled(JSON.parse(row.record_json), PRICE_SOURCES)) put.run(row.price_key, row.observed_at, row.signature, row.record_json);
      }
    },
  };
}
