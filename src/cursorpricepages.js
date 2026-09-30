import { cursorModelSignature, cursorModelTokens } from './cursormodels.js';

export const CURSOR_MODEL_INDEX_URL = 'https://cursor.com/docs/llms.txt';

export function cursorModelPages(index) {
  const urls = [...new Set(String(index).match(/https:\/\/cursor\.com\/docs\/models\/[a-z0-9-]+(?:\.md)?(?=[\s)#]|$)/g) ?? [])]
    .map((url) => url.replace(/\.md$/, ''));
  if (!urls.length || urls.length > 200) throw new Error('Cursor model index has no usable model pages or exceeds the page limit');
  return [...new Set(urls)];
}

function text(html) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity.toLowerCase()];
      const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }).replace(/\s+/g, ' ').trim();
}

function amount(html) {
  const value = text(html).replace(/\s+/g, '');
  if (value === '-' || value === '—') return null;
  if (!/^\$\d+(?:\.\d+)?$/.test(value)) throw new Error(`invalid Cursor detail price: ${value}`);
  const n = Number(value.slice(1));
  if (!Number.isFinite(n)) throw new Error(`invalid Cursor detail price: ${value}`);
  return n;
}

function contextTier(name) {
  const match = /long context\s*\(?>\s*(\d+(?:\.\d+)?)([km]?)\)?/i.exec(name);
  if (/long context/i.test(name) && !match) throw new Error(`unrecognized Cursor context tier: ${name}`);
  const over = match ? Number(match[1]) * ({ k: 1000, m: 1e6 }[match[2].toLowerCase()] ?? 1) : null;
  if (over != null && !Number.isSafeInteger(over)) throw new Error(`invalid Cursor context threshold: ${name}`);
  return over;
}

export function cursorPriceKey(model) {
  return `${cursorModelSignature(model.name.replace(/long context\s*\(?>\s*\d+(?:\.\d+)?[km]?\)?/gi, ''))}\0${model.cursor?.contextOver ?? -1}`;
}

// Parse only visible price tables and labeled model metadata. Never evaluate
// page scripts or depend on generated CSS classes / Next.js hydration data.
export function parseCursorModelPage(html, overview, url) {
  html = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const title = text(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  const base = overview.find((model) => cursorModelSignature(model.name) === cursorModelSignature(title));
  if (!base) throw new Error(`Cursor detail model is absent from the overview: ${title || url}`);
  const id = /Model ID<\/[^>]+>\s*<[^>]+>([^<]+)</i.exec(html)?.[1]?.trim();
  if (!id || !/^[a-zA-Z0-9_.:/-]+$/.test(id)) throw new Error(`Cursor model ID was not found: ${title}`);
  const prices = new Map();
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((row) => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => cell[1]));
    const headers = rows.shift()?.map((cell) => text(cell).toLowerCase()) ?? [];
    if (!['name', 'model'].includes(headers[0]) || !['input', 'cache write', 'cache read', 'output'].every((h) => headers.includes(h))) continue;
    for (const cells of rows) {
      if (cells.length !== headers.length) throw new Error(`Cursor detail table changed columns: ${title}`);
      const name = text(/<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(cells[0])?.[1] ?? cells[0]);
      const contextOver = contextTier(name);
      const variant = cursorModelTokens(name.replace(/long context\s*\(?>\s*\d+(?:\.\d+)?[km]?\)?/gi, ''));
      for (const token of cursorModelTokens(title)) {
        const i = variant.indexOf(token);
        if (i < 0) throw new Error(`unrelated model in Cursor detail table: ${name}`);
        variant.splice(i, 1);
      }
      const get = (header) => amount(cells[headers.indexOf(header)]);
      const input = get('input'), output = get('output');
      if (input == null || output == null) throw new Error(`Cursor detail lacks input/output rates: ${name}`);
      const model = { name, provider: base.provider, pool: base.pool, input, output,
        cacheRead: get('cache read'), cacheWrite: get('cache write'), notes: '',
        cursor: { aliases: [variant.length ? `${id}-${variant.join('-')}` : id], contextOver, url } };
      const key = cursorPriceKey(model);
      const previous = prices.get(key);
      if (previous && ['input', 'output', 'cacheRead', 'cacheWrite'].some((part) => previous[part] !== model[part])) {
        throw new Error(`conflicting Cursor detail prices: ${name}`);
      }
      prices.set(key, model);
    }
  }
  if (!prices.size) throw new Error(`Cursor detail pricing table was not found: ${title}`);
  return [...prices.values()];
}
