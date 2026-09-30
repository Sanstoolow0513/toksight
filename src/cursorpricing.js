// Cursor publishes its own per-million-token rates as a Markdown table. Use
// them for Cursor reference estimates, separately from generic agent prices:
// a CSV "Included" row describes subscription usage, not a USD charge.

import fs from 'node:fs/promises';
import path from 'node:path';

import { configDir, PRICE_REFRESH_MS } from './pricing.js';
import { createPriceLookup, priceRecord } from './pricecatalog.js';
import { validCursorMetadata } from './cursormodels.js';
import { CURSOR_MODEL_INDEX_URL, cursorModelPages, cursorPriceKey, parseCursorModelPage } from './cursorpricepages.js';

export const CURSOR_PRICING_URL = 'https://cursor.com/docs/models-and-pricing.md';
const FETCH_TIMEOUT_MS = 4000;
const HEADERS = ['Model', 'Provider', 'Input', 'Cache write', 'Cache read', 'Output', 'Notes'];

function cellsOf(line) {
  if (!line.startsWith('|')) return null;
  const cells = [];
  let cell = '';
  for (let i = 1; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') { cell += '|'; i++; }
    else if (line[i] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += line[i];
  }
  if (cell.trim()) cells.push(cell.trim());
  return cells;
}

function rate(value) {
  if (value === '-') return null;
  if (!/^\$(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`invalid Cursor price: ${value}`);
  const n = Number(value.slice(1));
  if (!Number.isFinite(n)) throw new Error(`invalid Cursor price: ${value}`);
  return n;
}

function modelName(value) {
  const link = /^\[([^\]]+)\]\([^)]+\)$/.exec(value);
  return (link ? link[1] : value).trim();
}

export function parseCursorPricingMarkdown(markdown) {
  if (typeof markdown !== 'string') throw new Error('Cursor pricing response is not Markdown text');
  const models = [];
  const counts = { cursor: 0, other: 0 };
  const seen = new Set();
  let pool = null;
  let inTable = false;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      pool = heading[1] === '##' && heading[2] === 'Cursor Models' ? 'cursor'
        : heading[1] === '###' && heading[2] === 'Model pricing' ? 'other' : null;
      inTable = false;
      continue;
    }
    if (!pool) continue;
    const cells = cellsOf(line);
    if (!cells) { inTable = false; continue; }
    if (HEADERS.every((header, i) => cells[i]?.toLowerCase() === header.toLowerCase())) {
      inTable = true;
      continue;
    }
    if (!inTable || /^[-: ]+$/.test(cells[0])) continue;
    if (cells.length !== HEADERS.length) throw new Error('Cursor pricing table has changed columns');
    const name = modelName(cells[0]);
    const provider = cells[1];
    if (!name || !provider) throw new Error('Cursor pricing table has a row without a model or provider');
    const key = `${pool}:${name.toLowerCase()}`;
    if (seen.has(key)) throw new Error(`duplicate Cursor model price: ${name}`);
    seen.add(key);
    const input = rate(cells[2]), cacheWrite = rate(cells[3]);
    const cacheRead = rate(cells[4]), output = rate(cells[5]);
    if (input == null || output == null) throw new Error(`Cursor pricing lacks an input or output rate for ${name}`);
    models.push({ name, provider, pool, input, cacheWrite, cacheRead, output, notes: cells[6] });
    counts[pool]++;
  }
  if (!counts.cursor || !counts.other) throw new Error('Cursor pricing tables were not found');
  return models;
}

export function cursorPriceRecords(models) {
  return models.map((model) => priceRecord({
    scope: 'cursor', source: 'cursor', name: model.name, provider: model.provider, pool: model.pool,
    input: model.input / 1e6, output: model.output / 1e6,
    cacheRead: (model.cacheRead ?? model.input) / 1e6,
    cacheWrite: (model.cacheWrite ?? model.input) / 1e6,
    cacheReadFallback: model.cacheRead == null,
    cacheWriteFallback: model.cacheWrite == null,
    cursor: model.cursor,
  })).filter(Boolean);
}

export function createCursorPriceLookup(models) {
  const lookup = createPriceLookup(cursorPriceRecords(models));
  return (name, entry = null) => lookup(name, 'cursor', entry);
}

async function readCache(file) {
  try {
    const cached = JSON.parse(await fs.readFile(file, 'utf8'));
    if (![1, 2].includes(cached.version) || !Number.isFinite(cached.fetchedAt)) return null;
    if (cached.warnings != null && (!Array.isArray(cached.warnings) || !cached.warnings.every((w) => typeof w === 'string'))) return null;
    if (!Array.isArray(cached.models) || !cached.models.every((m) =>
      typeof m.name === 'string' && m.name.length > 0 &&
      validCursorMetadata(m.cursor) &&
      Number.isFinite(m.input) && m.input >= 0 &&
      Number.isFinite(m.output) && m.output >= 0 &&
      (m.cacheRead == null || Number.isFinite(m.cacheRead) && m.cacheRead >= 0) &&
      (m.cacheWrite == null || Number.isFinite(m.cacheWrite) && m.cacheWrite >= 0)) ||
        !cached.models.some((m) => m.pool === 'cursor') ||
        !cached.models.some((m) => m.pool === 'other')) return null;
    return cached;
  } catch { return null; }
}

// Reports, imports, and the web catalog update share this cache. --offline may
// read even an expired cache without network.
export async function getCursorPricing({ offline = false, force = false, env, home, fetchImpl = fetch, now = Date.now } = {}) {
  const file = path.join(configDir({ env, home }), 'cache', 'cursor-pricing.json');
  const cached = await readCache(file);
  const currentTime = now();
  const fresh = cached && currentTime >= cached.fetchedAt && currentTime - cached.fetchedAt < PRICE_REFRESH_MS;
  if ((fresh && cached.version === 2 && !force) || offline) {
    if (!cached) throw new Error('Cursor pricing is not cached; run an online report or import first');
    return { source: CURSOR_PRICING_URL, fetchedAt: new Date(cached.fetchedAt).toISOString(), state: fresh ? 'fresh' : 'stale (offline)', models: cached.models, warnings: cached.warnings ?? [] };
  }
  try {
    const fetchText = async (url) => {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > 4 * 1024 * 1024) throw new Error('Cursor pricing page exceeds size limit');
      return body;
    };
    const [table, index] = await Promise.allSettled([fetchText(CURSOR_PRICING_URL), fetchText(CURSOR_MODEL_INDEX_URL)]);
    if (table.status === 'rejected') throw table.reason;
    const overview = parseCursorPricingMarkdown(table.value);
    const fetchedAt = new Date(currentTime).toISOString();
    const catalog = new Map(overview.map((model) => [cursorPriceKey(model), { ...model, cursor: { url: CURSOR_PRICING_URL, fetchedAt } }]));
    const warnings = [];
    let pages = [];
    try {
      if (index.status === 'rejected') throw index.reason;
      pages = cursorModelPages(index.value);
    } catch (err) { warnings.push(`Cursor model discovery unavailable; using overview and saved prices (${err.message})`); }
    let next = 0;
    const results = new Array(pages.length);
    const workers = await Promise.allSettled(Array.from({ length: Math.min(4, pages.length) }, async () => {
      while (next < pages.length) {
        const i = next++;
        try { results[i] = { models: parseCursorModelPage(await fetchText(pages[i]), overview, pages[i]) }; }
        catch (err) { results[i] = { error: err.message }; }
      }
    }));
    for (const worker of workers) if (worker.status === 'rejected') throw worker.reason;
    for (let i = 0; i < results.length; i++) {
      if (results[i].error) { warnings.push(`Cursor model details unavailable: ${pages[i]} (${results[i].error})`); continue; }
      for (const model of results[i].models) catalog.set(cursorPriceKey(model), { ...model, cursor: { ...model.cursor, fetchedAt } });
    }
    let retained = 0;
    for (const model of cached?.models ?? []) {
      const current = catalog.get(cursorPriceKey(model));
      if (current) {
        // Keep learned IDs for old CSVs when a detail page is temporarily
        // unavailable or now publishes another spelling of the same model.
        const aliases = [...new Set([...(current.cursor?.aliases ?? []), ...(model.cursor?.aliases ?? [])])];
        if (aliases.length) current.cursor.aliases = aliases;
        continue;
      }
      catalog.set(cursorPriceKey(model), { ...model, cursor: { ...model.cursor,
        fetchedAt: model.cursor?.fetchedAt ?? new Date(cached.fetchedAt).toISOString(), retained: true } });
      retained++;
    }
    if (retained) warnings.push(`Cursor retained ${retained} previously fetched model prices missing from this update; their original fetch dates are preserved`);
    const models = [...catalog.values()];
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ version: 2, fetchedAt: currentTime, models, warnings }));
    } catch { /* Rates are usable for this report even if the cache is read-only. */ }
    return { source: CURSOR_PRICING_URL, fetchedAt, state: 'refreshed', models, warnings };
  } catch (err) {
    if (!cached) throw new Error(`Cursor pricing unavailable: ${err.message}`, { cause: err });
    return {
      source: CURSOR_PRICING_URL, fetchedAt: new Date(cached.fetchedAt).toISOString(),
      state: 'stale', models: cached.models,
      warnings: [`Cursor pricing could not be refreshed; using cached rates (${err.message})`],
    };
  }
}
