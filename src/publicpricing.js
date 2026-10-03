// Public prices are downloaded by this machine and committed to its SQLite.
// No shared catalog service, credentials, or agent configuration is required.
import { priceRecord } from './pricecatalog.js';

export const PUBLIC_PRICE_SOURCES = {
  openai: 'https://developers.openai.com/api/docs/pricing',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  google: 'https://ai.google.dev/gemini-api/docs/pricing?hl=en',
  openrouter: 'https://openrouter.ai/api/v1/models',
};

const nonnegative = (n) => Number.isFinite(n) && n >= 0;
export function htmlText(html) {
  return String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|le|quot|apos|nbsp);/g, (v) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&le;': '<=', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[v])
    .replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '')
    .replace(/\s+/g, ' ').trim();
}
const cleanHtml = (html) => String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
const tableRows = (html) => [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  .map((row) => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => cell[1]));
const dollar = (value) => {
  const match = /^\$(\d+(?:\.\d+)?)(?:\s*\/\s*MTok)?$/.exec(htmlText(value));
  return match ? Number(match[1]) / 1e6 : null;
};
function record(source, name, input, output, cacheRead, cacheWrite, extra = {}) {
  if (input == null || output == null) return null;
  return priceRecord({ source, name, provider: source, input, output,
    cacheRead: cacheRead ?? input, cacheWrite: cacheWrite ?? input,
    cacheReadFallback: cacheRead == null, cacheWriteFallback: cacheWrite == null,
    ...extra, official: { channel: source, url: PUBLIC_PRICE_SOURCES[source], ...extra.official } });
}

export function parseOpenAIPrices(html) {
  const records = new Map();
  // The official page keeps collapsed rows in serialized component props.
  // Decode only this table's serialized data shape; never run page scripts.
  const unpack = (value) => {
    if (!Array.isArray(value) || value.length !== 2) throw new Error('OpenAI table serialization changed');
    if (value[0] === 0) return value[1];
    if (value[0] === 1 && Array.isArray(value[1])) return value[1].map(unpack);
    throw new Error('OpenAI table serialization changed');
  };
  for (const island of cleanHtml(html).matchAll(/<astro-island\b([^>]*)>/gi)) {
    if (!/component-export="TextTokenPricingTables"/.test(island[1])) continue;
    const encoded = /\bprops="([^"]*)"/.exec(island[1])?.[1];
    if (!encoded) continue;
    const props = JSON.parse(encoded.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    if (unpack(props.tier) !== 'standard') continue;
    for (const cells of unpack(props.rows)) {
      const name = /^(gpt-[a-z0-9.-]+|o\d[a-z0-9.-]*|chatgpt-[a-z0-9.-]+)(?:\s*\(([^)]+)\))?$/.exec(cells[0]);
      if (!name || ![4,5].includes(cells.length)) continue;
      const rate = (n) => nonnegative(n) ? n / 1e6 : null;
      const price = record('openai', name[1], rate(cells[1]), rate(cells.at(-1)), rate(cells[2]), cells.length === 5 ? rate(cells[3]) : 0,
        { official: { reference: true, ...(name[2] ? { unresolvedLongContext: true } : {}) } });
      if (price && !records.has(name[1])) records.set(name[1], price);
    }
  }
  for (const table of cleanHtml(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = tableRows(table[1]);
    const header = rows.find((row) => htmlText(row[0]).toLowerCase() === 'model');
    if (!header) continue;
    const headers = header.map((cell) => htmlText(cell).toLowerCase());
    if (!headers.includes('input') || !headers.includes('output')) continue;
    for (const row of rows) {
      const name = htmlText(row[0]);
      if (!/^(?:gpt-|o\d|chatgpt-)[a-z0-9.-]+$/.test(name)) continue;
      if (records.has(name)) {
        if (headers.filter((h) => h === 'input').length > 1) records.get(name).official.unresolvedLongContext = true;
        continue;
      }
      const get = (key) => headers.includes(key) ? dollar(row[headers.indexOf(key)] ?? '') : null;
      const price = record('openai', name, get('input'), get('output'), get('cached input'),
        headers.includes('cache writes') ? get('cache writes') : 0,
        { official: { reference: true, ...(headers.filter((h) => h === 'input').length > 1 ? { unresolvedLongContext: true } : {}) } });
      if (price) records.set(name, price); // First published table is Standard; later tabs are Batch/Flex/Fast.
    }
  }
  if (!records.size) throw new Error('OpenAI standard token pricing tables were not found');
  return [...records.values()];
}

export function parseAnthropicPrices(html) {
  for (const table of cleanHtml(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = tableRows(table[1]);
    if (!rows.some((row) => row.map(htmlText).some((cell) => /5m writes|5-minute cache writes/i.test(cell)))) continue;
    const records = [];
    for (const row of rows) {
      const name = /Claude\s+(Opus|Sonnet|Haiku|Fable|Mythos)\s+(\d+(?:\.\d+)?)/i.exec(htmlText(row[0]));
      if (!name || row.length !== 6) continue;
      const id = `claude-${name[1].toLowerCase()}-${name[2].replace('.', '-')}`;
      const price = record('anthropic', id, dollar(row[1]), dollar(row[2]), dollar(row[5]), dollar(row[3]),
        { official: { reference: true, ...(dollar(row[4]) != null ? { cacheWrite1h: dollar(row[4]) } : {}) } });
      if (price) records.push(price);
    }
    if (!records.length) throw new Error('Anthropic pricing table has no usable model rows');
    return records;
  }
  throw new Error('Anthropic standard token pricing table was not found');
}

// Only text Standard rates with unambiguous units. Explicit dated promotions
// select the price observed now; future changes are learned on later updates.
export function parseGooglePrices(html, at = Date.now()) {
  const sections = cleanHtml(html).split(/(?=<h2\b)/i), records = [];
  for (const section of sections) {
    const id = /<code[^>]*>\s*(gemini-[a-z0-9.-]+)\s*<\/code>/i.exec(section)?.[1];
    if (!id || /image|audio|live|tts|robotics/.test(id)) continue;
    const standard = /<h3\b[^>]*>\s*Standard\s*<\/h3>\s*<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(section);
    if (!standard) continue;
    const rows = tableRows(standard[1]);
    const cell = (label) => rows.find((row) => htmlText(row[0]).toLowerCase().startsWith(label))?.[2] ?? '';
    const rate = (label) => {
      const value = label === 'context caching price'
        ? cell(label).split(/<br\s*\/?\s*>/i).filter((part) => !/storage price|per hour|tokens per hour/i.test(htmlText(part))).join(' ')
        : cell(label);
      const dated = cell(label).split(/<br\s*\/?\s*>/i).map(htmlText).map((part) => /^\$(\d+(?:\.\d+)?)\s+(through|starting)\s+([A-Za-z]+ \d{1,2}, \d{4})\.?$/.exec(part)).filter(Boolean);
      if (dated.length >= 2) {
        const applicable = dated.find((match) => {
          const day = Date.parse(`${match[3]} 00:00:00 GMT`);
          return Number.isFinite(day) && (match[2] === 'through' ? at < day + 86400000 : at >= day);
        });
        if (applicable) return { base: Number(applicable[1]) / 1e6 };
        return null;
      }
      const text = htmlText(/\(audio\)/.test(value) ? value.split(/<br\s*\/?\s*>/i)[0] : value);
      const simple = /^\$(\d+(?:\.\d+)?)(?:\s*\(text\s*\/\s*image\s*\/\s*video(?:\s*\/\s*audio)?\))?$/.exec(text);
      if (simple) return { base: Number(simple[1]) / 1e6 };
      const tier = /^\$(\d+(?:\.\d+)?),?\s*prompts\s*(?:<=?|≤)\s*(\d+)k(?:\s*tokens)?\s*\$(\d+(?:\.\d+)?),?\s*prompts\s*>\s*\2k(?:\s*tokens)?$/.exec(text);
      return tier ? { base: Number(tier[1]) / 1e6, contextOver: Number(tier[2]) * 1000, above: Number(tier[3]) / 1e6 } : null;
    };
    const input = rate('input price'), output = rate('output price');
    if (!input || !output) continue;
    // Cache storage/hour is a separate charge; keep only the explicit token rate.
    const cacheCell = cell('context caching price').split(/<br\s*\/?\s*>/i)[0];
    const readText = htmlText(cacheCell).replace(/\s*\(text\s*\/\s*image\s*\/\s*video\)/, '');
    const readRate = rate('context caching price');
    const read = readRate?.base ?? dollar(readText);
    const contextTiers = input.contextOver && output.contextOver === input.contextOver ? [{
      contextOver: input.contextOver, input: input.above, output: output.above,
      cacheRead: readRate?.contextOver === input.contextOver ? readRate.above : read ?? input.above,
      cacheWrite: 0, cacheReadFallback: read == null, cacheWriteFallback: false,
    }] : null;
    const price = record('google', id, input.base, output.base, read, 0,
      { contextTiers, official: { reference: true } });
    if (price) records.push(price);
  }
  if (!records.length) throw new Error('Google standard text token pricing tables were not found');
  return records;
}

function routerRates(pricing) {
  const numeric = (key) => {
    const value = pricing?.[key];
    return typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : null;
  };
  const input = numeric('prompt'), output = numeric('completion'), discount = pricing?.discount ?? 0;
  if (!nonnegative(input) || !nonnegative(output) || !nonnegative(discount) || discount > 1) return null;
  const read = numeric('input_cache_read'), write = numeric('input_cache_write');
  if ([read, write].some((n) => n != null && !nonnegative(n))) return null;
  const factor = 1 - discount;
  return { input: input * factor, output: output * factor, cacheRead: (read ?? input) * factor,
    cacheWrite: (write ?? input) * factor, cacheReadFallback: read == null, cacheWriteFallback: write == null };
}
export function parseOpenRouterPrices(body, model = null) {
  const models = model ? body?.data?.endpoints : body?.data;
  if (!Array.isArray(models) || !models.length || models.length > 10000) throw new Error('invalid OpenRouter price catalog');
  const records = [];
  for (const item of models) {
    const id = model ?? item.id, rates = routerRates(item.pricing);
    if (!rates || typeof id !== 'string' || !/^[a-z0-9_.:/-]+$/i.test(id)) continue;
    const rules = [];
    for (const override of item.pricing.overrides ?? []) {
      const adjusted = routerRates({ ...item.pricing, ...override });
      if (!adjusted) throw new Error('invalid OpenRouter conditional prices');
      const fields = { prompt: 'input', completion: 'output', input_cache_read: 'cacheRead', input_cache_write: 'cacheWrite' };
      const rule = Object.fromEntries(Object.entries(fields).filter(([key]) => override[key] != null).map(([, part]) => [part, adjusted[part]]));
      if (override.input_cache_read != null) rule.cacheReadFallback = false;
      if (override.input_cache_write != null) rule.cacheWriteFallback = false;
      if (override.min_prompt_tokens != null) rule.contextOver = override.min_prompt_tokens;
      if (override.utc_start != null) rule.utcStart = override.utc_start;
      if (override.utc_end != null) rule.utcEnd = override.utc_end;
      if (override.utc_days != null) rule.utcDays = override.utc_days;
      rules.push(rule);
    }
    const endpoint = model ? item.tag : null;
    const row = priceRecord({ source: 'openrouter', provider: 'openrouter', name: endpoint ? `${id}@${endpoint}` : id, ...rates,
      official: { channel: 'openrouter', reference: !endpoint, ...(endpoint ? { endpoint, aliases: [id] } : {}), rules,
        url: endpoint ? `${PUBLIC_PRICE_SOURCES.openrouter}/${id}/endpoints` : PUBLIC_PRICE_SOURCES.openrouter,
        ...(item.pricing.input_cache_write_1h != null ? { cacheWrite1h: Number(item.pricing.input_cache_write_1h) * (1 - (item.pricing.discount ?? 0)) } : {}) } });
    if (row) records.push(row);
  }
  if (!records.length) throw new Error('OpenRouter catalog has no usable token prices');
  return records;
}

export async function getPublicPricing({ offline = false, now = Date.now, fetchImpl = fetch, routerModels = [] } = {}) {
  if (offline) return { records: [], sourceDetails: Object.fromEntries(Object.entries(PUBLIC_PRICE_SOURCES).map(([source,url]) => [source, { fetchedAt: null, state: 'skipped (offline)', url }])), warnings: [], sources: [] };
  const time = new Date(now()).toISOString();
  const fetchBody = async (url, json = false) => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(12000), headers: { 'accept-language': 'en' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 12 * 1024 * 1024) throw new Error('price response exceeds 12 MB');
    return json ? JSON.parse(text) : text;
  };
  const parsers = { openai: parseOpenAIPrices, anthropic: parseAnthropicPrices, google: parseGooglePrices, openrouter: parseOpenRouterPrices };
  const result = { records: [], sourceDetails: {}, sources: [], warnings: [] };
  const fetched = await Promise.allSettled(Object.entries(PUBLIC_PRICE_SOURCES).map(async ([source, url]) => {
    const body = await fetchBody(url, source === 'openrouter');
    const records = source === 'google' ? parseGooglePrices(body, now()) : parsers[source](body);
    return { source, url, records };
  }));
  for (let i = 0; i < fetched.length; i++) {
    const source = Object.keys(PUBLIC_PRICE_SOURCES)[i], value = fetched[i];
    if (value.status === 'fulfilled') {
      result.records.push(...value.value.records); result.sources.push(source);
      result.sourceDetails[source] = { fetchedAt: time, state: 'refreshed', url: value.value.url };
    } else {
      result.warnings.push(`${source} pricing unavailable; keeping saved prices (${value.reason?.message || value.reason})`);
      result.sourceDetails[source] = { fetchedAt: null, state: 'unavailable', url: PUBLIC_PRICE_SOURCES[source] };
    }
  }
  // Fetch details only for models actually used through this router, with a
  // bounded worker pool; never make hundreds of requests at first setup.
  const ids = [...new Set(routerModels)].filter((id) => /^[a-z0-9_.-]+\/[a-z0-9_.:/-]+$/i.test(id)).slice(0,100);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try { result.records.push(...parseOpenRouterPrices(await fetchBody(`${PUBLIC_PRICE_SOURCES.openrouter}/${id}/endpoints`, true), id)); }
      catch (err) { result.warnings.push(`OpenRouter endpoint prices unavailable for ${id} (${err.message})`); }
    }
  }));
  return result;
}
