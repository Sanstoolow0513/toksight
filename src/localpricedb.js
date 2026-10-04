import { readPriceSources, validPriceSources } from './priceselection.js';
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
  const readKey = db.prepare('SELECT observed_at, record_json FROM price_history WHERE price_key = ? ORDER BY observed_at DESC');
  const summary = db.prepare('SELECT price_key, COUNT(*) AS revisions, MAX(observed_at) AS observedAt FROM price_history GROUP BY price_key');
  const setup = db.prepare('SELECT * FROM web_setup WHERE id = 1');
  const counts = db.prepare('SELECT COUNT(*) AS revisions, COUNT(DISTINCT price_key) AS prices, MAX(observed_at) AS observedAt FROM price_history');
  return {
    observe(records, at) {
      for (const record of records) {
        if (!['openai', 'anthropic', 'google', 'openrouter', 'openrouter-native', 'cursor'].includes(record.source)) continue;
        const key = historyPriceKey(record), signature = priceSignature(record), previous = latest.get(key);
        if (previous && (at < previous.observed_at || signature === previous.signature)) continue;
        insert.run(key, at, signature, JSON.stringify(record));
      }
    },
    read: () => read.all(),
    summary: () => summary.all(),
    history: (key) => readKey.all(key).map((row) => ({ observedAt: row.observed_at, record: JSON.parse(row.record_json) })),
    status() {
      const row = setup.get();
      return { selectedSources: readPriceSources(db), completed: Boolean(row), completedAt: row?.completed_at ?? null, autoUpdate: row ? Boolean(row.auto_update) : true, ...counts.get() };
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
      for (const row of rows) put.run(row.price_key, row.observed_at, row.signature, row.record_json);
    },
  };
}
