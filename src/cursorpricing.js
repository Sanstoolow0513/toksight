// Cursor publishes its own per-million-token rates as a Markdown table. Use
// them for Cursor reference estimates, separately from generic agent prices:
// a CSV "Included" row describes subscription usage, not a USD charge.

import fs from 'node:fs/promises';
import path from 'node:path';

import { configDir, PRICE_REFRESH_MS } from './pricing.js';
import { createPriceLookup, priceRecord } from './pricecatalog.js';

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
  })).filter(Boolean);
}

export function createCursorPriceLookup(models) {
  const lookup = createPriceLookup(cursorPriceRecords(models));
  return (name) => lookup(name, 'cursor');
}

async function readCache(file) {
  try {
    const cached = JSON.parse(await fs.readFile(file, 'utf8'));
    if (cached.version !== 1 || !Number.isFinite(cached.fetchedAt)) return null;
    if (!Array.isArray(cached.models) || !cached.models.every((m) =>
      typeof m.name === 'string' && m.name.length > 0 &&
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
  if ((fresh && !force) || offline) {
    if (!cached) throw new Error('Cursor pricing is not cached; run an online report or import first');
    return { source: CURSOR_PRICING_URL, fetchedAt: new Date(cached.fetchedAt).toISOString(), state: fresh ? 'fresh' : 'stale (offline)', models: cached.models, warnings: [] };
  }
  try {
    const response = await fetchImpl(CURSOR_PRICING_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const models = parseCursorPricingMarkdown(await response.text());
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ version: 1, fetchedAt: currentTime, models }));
    } catch { /* Rates are usable for this report even if the cache is read-only. */ }
    return { source: CURSOR_PRICING_URL, fetchedAt: new Date(currentTime).toISOString(), state: 'refreshed', models, warnings: [] };
  } catch (err) {
    if (!cached) throw new Error(`Cursor pricing unavailable: ${err.message}`, { cause: err });
    return {
      source: CURSOR_PRICING_URL, fetchedAt: new Date(cached.fetchedAt).toISOString(),
      state: 'stale', models: cached.models,
      warnings: [`Cursor pricing could not be refreshed; using cached rates (${err.message})`],
    };
  }
}
