import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CURSOR_MODEL_INDEX_URL, cursorModelPages, parseCursorModelPage } from '../src/cursorpricepages.js';
import { CURSOR_PRICING_URL, createCursorPriceLookup, cursorPriceRecords, getCursorPricing, parseCursorPricingMarkdown } from '../src/cursorpricing.js';
import { createUsageDatabase } from '../src/database.js';
import { parseCursorCsv } from '../src/cursorcsv.js';
import { buildPayload } from '../src/payload.js';
import { collectAll } from '../src/collect.js';
import { DatabaseSync } from 'node:sqlite';

const markdown = await readFile(new URL('./fixtures/cursor/pricing.md', import.meta.url), 'utf8');
const html = await readFile(new URL('./fixtures/cursor/model-orbit.html', import.meta.url), 'utf8');
const overview = parseCursorPricingMarkdown(markdown);
const url = 'https://cursor.com/docs/models/nebula-orbit-8-2';
const index = `- ${url}.md\n- ${url}\n- https://example.com/docs/models/wrong.md\n`;
const prompt = (inputTokens) => ({ inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });

test('official model discovery and table parsing handle arbitrary families, repeated markup and explicit tiers', () => {
  assert.deepEqual(cursorModelPages(index), [url]);
  assert.throws(() => cursorModelPages('https://example.com/docs/models/fake.md'), /no usable/);
  const models = parseCursorModelPage(html + html, overview, url);
  assert.equal(models.length, 4);
  const lookup = createCursorPriceLookup([...overview, ...models.slice(1)]);
  assert.equal(lookup('orbit8.2-high').input, 1e-6);
  assert.equal(lookup('orbit8.2-max-high').input, 3e-6, 'catalog Max model beats removing Max as a mode');
  assert.equal(lookup('orbit8.2-xhigh-fast').input, 2e-6);
  assert.equal(lookup('orbit8.2-high', prompt(100000)).input, 1e-6);
  assert.equal(lookup('orbit8.2-high', { inputTokens: 99999, cacheReadTokens: 1, cacheWriteTokens: 1 }).input, 2e-6);
  assert.equal(lookup('orbit8.2-high-fast', prompt(100001)).input, 4e-6);
  assert.equal(lookup('orbit8.2-ultrafast'), null);
  const namedDifferently = parseCursorModelPage(html.replace('nebula-orbit-8-2</div>', 'nebula-identifier-7</div>'), overview, url);
  assert.equal(createCursorPriceLookup(namedDifferently)('nebula-identifier-7-high-fast').input, 2e-6);
  assert.throws(() => parseCursorModelPage(html.replace('$1.25', 'variable'), overview, url), /invalid Cursor detail price/);
  assert.throws(() => parseCursorModelPage(html.replaceAll('&gt;100k', 'unknown'), overview, url), /unrecognized Cursor context tier/);
  assert.throws(() => parseCursorModelPage(html + html.replace('$1.25', '$99'), overview, url), /conflicting/);
});

test('discovered prices upgrade old caches, remain usable offline and retain prior detail prices after partial fetch failure', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-discovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'cache'));
  await writeFile(path.join(dir, 'cache', 'cursor-pricing.json'), JSON.stringify({ version: 1, fetchedAt: 1000,
    models: [...overview, { ...overview[1], name: 'Retired Beacon 2' }] }));
  const requests = [];
  let failDetail = false;
  const fetchImpl = async (target) => {
    requests.push(target);
    if (failDetail && target === url) throw new Error('detail unavailable');
    const pages = { [CURSOR_PRICING_URL]: markdown, [CURSOR_MODEL_INDEX_URL]: index, [url]: html };
    assert.ok(Object.hasOwn(pages, target), `unexpected URL: ${target}`);
    return { ok: true, text: async () => pages[target] };
  };
  const opts = { env: { TOKSIGHT_CONFIG_DIR: dir }, home: dir, fetchImpl, now: () => 2000 };
  const first = await getCursorPricing(opts);
  assert.equal(first.state, 'refreshed', 'version 1 cache upgrades even before its TTL expires');
  assert.equal(requests.length, 3);
  assert.equal(first.models.length, 7);
  assert.equal(createCursorPriceLookup(first.models)('beacon2-max').cursor.retained, true);
  assert.equal(createCursorPriceLookup(first.models)('beacon2-max').cursor.fetchedAt, new Date(1000).toISOString());
  assert.equal((await getCursorPricing(opts)).state, 'fresh');
  assert.equal(requests.length, 3);
  failDetail = true;
  const partial = await getCursorPricing({ ...opts, force: true, now: () => 3000 });
  assert.match(partial.warnings.join('\n'), /detail unavailable/);
  assert.deepEqual(partial.models.find((m) => m.name === 'Nebula Orbit 8.2').cursor.aliases, ['nebula-orbit-8-2']);
  const fast = createCursorPriceLookup(partial.models)('orbit8.2-high-fast', prompt(100001));
  assert.equal(fast.input, 4e-6);
  assert.equal(fast.cursor.retained, true);
  assert.equal(fast.cursor.fetchedAt, new Date(2000).toISOString());
  const offline = await getCursorPricing({ ...opts, offline: true });
  assert.equal(requests.length, 6);
  assert.equal(createCursorPriceLookup(offline.models)('orbit8.2-high-fast', prompt(100001)).input, 4e-6);
});

test('per-request context tiers survive SQLite, backup and offline CLI; mixed-rate rows hide a misleading single unit price', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-tier-db-'));
  const env = { TOKSIGHT_CONFIG_DIR: dir };
  const source = createUsageDatabase({ file: ':memory:' }), target = createUsageDatabase({ env, home: dir });
  t.after(async () => { source.close(); target.close(); await rm(dir, { recursive: true, force: true }); });
  const models = [...overview, ...parseCursorModelPage(html, overview, url).slice(1)];
  source.replace({ entries: [], warnings: [], reportedCosts: new WeakSet(), pricing: {
    records: cursorPriceRecords(models), sources: { cursor: 'fresh' }, priceFor: () => null, configDir: dir,
  } });
  const header = 'Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost';
  source.importCursor(parseCursorCsv(header + '\n' + [
    '2026-09-01T12:00:00Z,,,Included,orbit8.2-high,No,0,100000,0,0,100000,Included',
    '2026-09-01T12:01:00Z,,,Included,orbit8.2-high,No,0,100001,0,0,100001,Included',
    '2026-09-01T12:02:00Z,,,Included,orbit8.2-high-fast,No,0,100001,0,0,100001,$0.75',
  ].join('\n')).records);
  assert.equal(target.importDatabase(source.exportDatabase()).imported, 3);
  const snapshot = target.read();
  assert.ok(Math.abs(snapshot.entries[0].costUsd - 0.1) < 1e-12);
  assert.ok(Math.abs(snapshot.entries[1].costUsd - 0.200002) < 1e-12);
  assert.equal(snapshot.entries[2].costUsd, 0.75);
  const payload = buildPayload({ ...snapshot, opts: { since: null, until: null, clients: null, top: 20 } });
  const rate = payload.pricing.modelRates.find((row) => row.model === 'orbit8.2-high');
  assert.equal(rate.variableRates, true);
  assert.equal(rate.source, null);
  assert.equal(rate.input, undefined);
  assert.equal(payload.models.find((row) => row.model === 'Nebula Orbit 8.2').requests, 2);
  const cli = await collectAll({ offline: true, clients: ['cursor'], since: null, until: null }, { env, home: dir });
  assert.ok(Math.abs(cli.entries[1].costUsd - 0.200002) < 1e-12);
  assert.equal(cli.entries[2].costUsd, 0.75);
});

test('price metadata migrates on legacy databases and old backups remain importable', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-tier-migrate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'legacy.sqlite');
  const original = createUsageDatabase({ file });
  original.replace({ entries: [], warnings: [], reportedCosts: new WeakSet(), pricing: {
    records: cursorPriceRecords(overview), sources: { cursor: 'fresh' }, priceFor: () => null, configDir: dir,
  } });
  original.close();
  const legacy = new DatabaseSync(file);
  legacy.exec('ALTER TABLE model_prices DROP COLUMN metadata_json');
  legacy.close();
  const imported = createUsageDatabase({ file: ':memory:' });
  try {
    assert.equal(imported.importDatabase(await readFile(file)).entries, 0);
    assert.equal(imported.read().pricing.priceFor('orbit8.2-high', 'cursor').input, 1e-6);
  } finally { imported.close(); }
  const migrated = createUsageDatabase({ file });
  try { assert.equal(migrated.read().pricing.priceFor('orbit8.2-high', 'cursor').input, 1e-6); }
  finally { migrated.close(); }
});
