import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createCursorPriceLookup, cursorPriceRecords, getCursorPricing, parseCursorPricingMarkdown } from '../src/cursorpricing.js';
import { createUsageDatabase } from '../src/database.js';
import { parseCursorCsv } from '../src/cursorcsv.js';
import { collectAll } from '../src/collect.js';
import { parseArgs } from '../src/args.js';
import { buildCostCoverage } from '../src/costcoverage.js';
import { buildPayload } from '../src/payload.js';
import { PRICE_REFRESH_MS } from '../src/pricing.js';

const markdown = `# Models & Pricing
## Cursor Models
| Model | Provider | Input | Cache write | Cache read | Output | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [Composer 2.5](https://cursor.com/blog/composer-2-5) | Cursor | $0.5 | - | $0.2 | $2.5 | Standard |
| Grok 4.7 (Fast) | Cursor | $4 | - | $1 | $12 | Fast mode |
## Other Models
### Model pricing
All prices are per million tokens:
| Model | Provider | Input | Cache write | Cache read | Output | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Claude 4.5 Sonnet | Anthropic | $3 | $3.75 | $0.3 | $15 | - |
| GPT-5 | OpenAI | $1.25 | - | $0.125 | $10 | - |
| GPT-5 Fast | OpenAI | $2.5 | - | $0.25 | $20 | - |
## Plans
| Plan | Price | Included |
| --- | --- | --- |
| Pro | $20 | Yes |
`;

test('Cursor Markdown rates match exact model IDs and keep Fast variants separate', () => {
  const models = parseCursorPricingMarkdown(markdown);
  assert.equal(models.length, 5);
  assert.deepEqual(models.map((m) => m.name), ['Composer 2.5', 'Grok 4.7 (Fast)', 'Claude 4.5 Sonnet', 'GPT-5', 'GPT-5 Fast']);
  const priceFor = createCursorPriceLookup(models);
  assert.equal(priceFor('claude-sonnet-4-5').cacheWrite, 3.75e-6);
  assert.equal(priceFor('gpt-5').input, 1.25e-6);
  assert.equal(priceFor('gpt-5').cacheWrite, 1.25e-6);
  assert.equal(priceFor('gpt-5').cacheWriteFallback, true);
  assert.equal(priceFor('gpt-5-fast').input, 2.5e-6);
  assert.equal(priceFor('grok-4-7-fast').output, 12e-6);
  assert.equal(priceFor('auto'), null);
  assert.equal(priceFor('gpt-5-unknown'), null);
  assert.throws(() => parseCursorPricingMarkdown(markdown.replace('| $1.25 | - | $0.125 |', '| variable | - | $0.125 |')), /invalid Cursor price/);
  assert.throws(() => parseCursorPricingMarkdown('# Models & Pricing'), /tables were not found/);
});

test('official prices are cached, usable offline and stale fallback survives fetch failures', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-cursor-prices-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { TOKSIGHT_CONFIG_DIR: dir };
  let requests = 0;
  const fetchImpl = async () => { requests++; return { ok: true, text: async () => markdown }; };
  const first = await getCursorPricing({ env, home: dir, fetchImpl, now: () => 1_000_000 });
  assert.equal(first.state, 'refreshed');
  assert.equal(first.models.length, 5);
  const fresh = await getCursorPricing({ env, home: dir, fetchImpl, now: () => 1_000_001 });
  assert.equal(fresh.state, 'fresh');
  assert.equal(requests, 1);
  const forced = await getCursorPricing({ env, home: dir, force: true, fetchImpl, now: () => 1_000_002 });
  assert.equal(forced.state, 'refreshed');
  assert.equal(requests, 2);
  const expired = 1_000_002 + PRICE_REFRESH_MS + 1;
  const offline = await getCursorPricing({ env, home: dir, offline: true, fetchImpl, now: () => expired });
  assert.equal(offline.state, 'stale (offline)');
  assert.equal(requests, 2);
  const stale = await getCursorPricing({ env, home: dir, fetchImpl: async () => { throw new Error('network down'); }, now: () => expired });
  assert.equal(stale.state, 'stale');
  assert.match(stale.warnings[0], /network down/);
});

test('Cursor Included uses official rates in CLI and SQLite while CSV charges remain authoritative', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-cursor-estimate-'));
  const env = { TOKSIGHT_CONFIG_DIR: dir };
  const db = createUsageDatabase({ env, home: dir });
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const sourceCsv = (await readFile(new URL('./fixtures/cursor/usage.csv', import.meta.url), 'utf8'))
    .replaceAll('cursor-test-model', 'gpt-5');
  const unknown = sourceCsv.split('\n')[1]
    .replace('12:19:00.334Z', '12:22:00.334Z')
    .replace('"49","Included"', '"49","unknown"');
  const csv = `${sourceCsv.trimEnd()}\n${unknown}\n`;
  db.importCursor(parseCursorCsv(csv).records);
  await writeFile(path.join(dir, 'pricing.json'), JSON.stringify({ 'gpt-5': { input: 999, output: 999 } }));
  await getCursorPricing({ env, home: dir, fetchImpl: async () => ({ ok: true, text: async () => markdown }) });

  const result = await collectAll(parseArgs(['--offline', '--client', 'cursor']), { env, home: dir });
  const expected = (5 * 1.25 + 10 * 1.25 + 30 * 0.125 + 4 * 10) / 1e6;
  assert.ok(Math.abs(result.entries[0].costUsd - expected) < 1e-12);
  assert.equal(result.entries[1].costUsd, 0.25);
  assert.equal(result.entries[2].costUsd, null);
  assert.equal(result.pricing.sources.cursor, 'fresh');
  const cliCoverage = buildCostCoverage(result.entries, result);
  assert.equal(cliCoverage.sources.cursor.requests, 1);
  assert.equal(cliCoverage.sources.reported.requests, 1);
  assert.equal(cliCoverage.unpricedRequests, 1);
  assert.equal(cliCoverage.cacheFallbackRequests, 1);

  db.replace(result);
  const snapshot = db.read();
  assert.ok(Math.abs(snapshot.entries[0].costUsd - expected) < 1e-12);
  assert.equal(snapshot.entries[2].costUsd, null);
  assert.equal(buildCostCoverage(snapshot.entries, snapshot).sources.cursor.requests, 1);
  const corrected = csv.replace('"49","Included"', '"49","$0.75"');
  assert.equal(db.importCursor(parseCursorCsv(corrected).records).updated, 1);
  assert.equal(db.read().entries[0].costUsd, 0.75);
  assert.equal(buildCostCoverage(db.read().entries, db.read()).sources.reported.requests, 2);
});

test('Cursor Claude shorthand prices Included events and reports one model row per agent', async () => {
  const opusMarkdown = markdown.replace('| Claude 4.5 Sonnet |',
    '| Claude Opus 5.5 | Anthropic | $4 | $5 | $0.2 | $20 | - |\n| Claude 4.5 Sonnet |');
  const models = parseCursorPricingMarkdown(opusMarkdown);
  const priceFor = createCursorPriceLookup(models);
  const db = createUsageDatabase({ file: ':memory:' });
  try {
    db.replace({ entries: [], warnings: [], reportedCosts: new WeakSet(), pricing: {
      priceFor, records: cursorPriceRecords(models), sources: { cursor: 'fresh' }, configDir: '/fixture',
    } });
    const source = (await readFile(new URL('./fixtures/cursor/usage.csv', import.meta.url), 'utf8'))
      .replaceAll('cursor-test-model', 'opus5.5-high');
    const paid = source.split('\n')[1].replace('12:19:00.334Z', '12:23:00.334Z')
      .replace('opus5.5-high', 'opus5.5-medium').replace('"49","Included"', '"49","$0.75"');
    db.importCursor(parseCursorCsv(`${source.trimEnd()}\n${paid}\n`).records);
    const snapshot = db.read();
    const included = snapshot.entries.find((entry) => entry.model === 'opus5.5-high');
    assert.ok(Math.abs(included.costUsd - (5 * 5 + 10 * 4 + 30 * 0.2 + 4 * 20) / 1e6) < 1e-12);
    assert.equal(snapshot.entries.find((entry) => entry.model === 'opus5.5-medium').costUsd, 0.75);
    const payload = buildPayload({ ...snapshot, opts: { since: null, until: null, clients: null, top: 20 } });
    const opus = payload.models.find((row) => row.model === 'Claude Opus 5.5');
    assert.equal(opus.client, 'cursor');
    assert.equal(opus.requests, 2);
    assert.ok(Math.abs(opus.costUsd - (included.costUsd + 0.75)) < 1e-12);
    assert.deepEqual(opus.modelIds, ['opus5.5-high', 'opus5.5-medium']);
    assert.equal(buildCostCoverage(snapshot.entries, snapshot).sources.cursor.requests, 1);
    assert.equal(buildCostCoverage(snapshot.entries, snapshot).sources.reported.requests, 2);
  } finally { db.close(); }
});
