// Cursor's Settings > Usage export is a per-event CSV, not a session log.
// Keep the original token classes and reported charges; "Included" has no
// per-event USD amount; the report may add a separate public-rate estimate.

import { createHash } from 'node:crypto';

const COLUMNS = [
  'Date', 'Cloud Agent ID', 'Automation ID', 'Kind', 'Model', 'Max Mode',
  'Input (w/ Cache Write)', 'Input (w/o Cache Write)', 'Cache Read',
  'Output Tokens', 'Total Tokens', 'Cost',
];

function badCsv(message) {
  const err = new Error(`Cursor CSV: ${message}`);
  err.status = 400;
  err.code = 'BAD_CSV';
  return err;
}

// Small RFC 4180 reader. Quotes may contain commas, escaped quotes and line
// breaks; CRLF and a UTF-8 BOM are accepted without any runtime dependency.
function readRows(input) {
  const csv = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false, atStart = true;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else field += ch;
      continue;
    }
    if (ch === '"' && atStart) { quoted = true; atStart = false; continue; }
    if (ch === ',') { row.push(field); field = ''; atStart = true; afterQuote = false; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; field = ''; atStart = true; afterQuote = false;
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      continue;
    }
    if (afterQuote || ch === '"') throw badCsv(`invalid quoting near character ${i + 1}`);
    field += ch;
    atStart = false;
  }
  if (quoted) throw badCsv('unterminated quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function tokens(value) {
  if (value === '') return 0;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function timestampOf(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const midnight = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== match[1]) return NaN;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function cost(value) {
  const trimmed = value.trim();
  if (trimmed === '' || /^included$/i.test(trimmed)) return null;
  if (/^free$/i.test(trimmed)) return 0;
  if (!/^\$?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return undefined;
  const n = Number(trimmed.replace(/^\$/, ''));
  return Number.isFinite(n) ? n : undefined;
}

// Cursor does not export an event ID. These are the fields that identify a
// usage event across exports while billing labels and charges may change.
// The occurrence suffix preserves genuinely repeated, identical usage rows
// within one export. If Cursor revises tokens or a model name later, there is
// no reliable way to prove whether the row is the same event.
export function cursorIdentity(entry) {
  const fields = [entry.timestamp, entry.model, entry.inputTokens, entry.cacheReadTokens,
    entry.cacheWriteTokens, entry.outputTokens];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

// Older releases keyed imports by every CSV column, including mutable Cost and
// Kind. Treat those legacy hashes as variants of the same usage identity when
// reading, without deleting any stored rows. The largest occurrence count of
// one variant is the number of identical events; a later charge supersedes an
// unknown one. This also lets old databases accept a new upload idempotently.
export function selectCursorImports(rows, warnings = []) {
  const groups = new Map();
  for (const row of rows) {
    let entry;
    try { entry = JSON.parse(row.data_json); }
    catch { warnings.push('cursor: skipped a malformed imported record'); continue; }
    const identity = cursorIdentity(entry);
    let group = groups.get(identity);
    if (!group) { group = new Map(); groups.set(identity, group); }
    const colon = row.fingerprint.lastIndexOf(':');
    const suffix = row.fingerprint.slice(colon + 1);
    const occurrence = colon >= 0 && /^(0|[1-9]\d*)$/.test(suffix) ? Number(suffix) : 0;
    const variant = colon >= 0 ? row.fingerprint.slice(0, colon) : row.fingerprint;
    let variantRows = group.get(variant);
    if (!variantRows) { variantRows = new Map(); group.set(variant, variantRows); }
    variantRows.set(occurrence, { ...row, included: row.included == null ? 1 : row.included, entry });
  }
  const selected = [];
  for (const [identity, variants] of groups) {
    let count = 0;
    for (const variantRows of variants.values()) {
      for (const occurrence of variantRows.keys()) count = Math.max(count, occurrence + 1);
    }
    for (let occurrence = 0; occurrence < count; occurrence++) {
      let best = null;
      for (const variantRows of variants.values()) {
        const candidate = variantRows.get(occurrence);
        if (candidate && (!best || candidate.reported_cost > best.reported_cost ||
          (candidate.reported_cost === best.reported_cost && candidate.included > best.included) ||
          (candidate.reported_cost === best.reported_cost && candidate.included === best.included && candidate.rowid > best.rowid))) best = candidate;
      }
      if (best) selected.push({ ...best, key: `v2:${identity}:${occurrence}` });
    }
  }
  return selected;
}

export function parseCursorCsv(input) {
  if (typeof input !== 'string') throw badCsv('expected UTF-8 text');
  const rows = readRows(input);
  if (!rows.length) throw badCsv('file is empty');
  const header = rows.shift();
  const index = new Map(header.map((name, i) => [name.trim(), i]));
  if (index.size !== header.length || COLUMNS.some((column) => !index.has(column))) {
    throw badCsv(`expected Cursor usage columns: ${COLUMNS.join(', ')}`);
  }
  const records = [], warnings = [], occurrences = new Map();
  let skipped = 0, zeroUsage = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const get = (name) => row[index.get(name)]?.trim() ?? '';
    const values = ['Input (w/ Cache Write)', 'Input (w/o Cache Write)', 'Cache Read', 'Output Tokens', 'Total Tokens'].map((name) => tokens(get(name)));
    const timestamp = timestampOf(get('Date'));
    const model = get('Model');
    if (row.length !== header.length || !Number.isFinite(timestamp) || !model || values.some((n) => n == null)) {
      skipped++;
      if (warnings.length < 10) warnings.push(`row ${i + 2}: invalid date, model or token count`);
      continue;
    }
    const [cacheWriteTokens, inputTokens, cacheReadTokens, outputTokens, totalTokens] = values;
    const sum = cacheWriteTokens + inputTokens + cacheReadTokens + outputTokens;
    if (!Number.isSafeInteger(sum) || totalTokens !== sum) {
      skipped++;
      if (warnings.length < 10) warnings.push(`row ${i + 2}: Total Tokens does not match token columns`);
      continue;
    }
    if (totalTokens === 0) { zeroUsage++; continue; }
    const costValue = get('Cost');
    const costUsd = cost(costValue);
    const included = /^included$/i.test(costValue);
    if (costUsd === undefined && warnings.length < 10) warnings.push(`row ${i + 2}: unrecognized Cost value, kept as unpriced`);
    const entry = {
        client: 'cursor', sessionId: null, model, timestamp,
        inputTokens, outputTokens, reasoningTokens: 0, cacheReadTokens,
        cacheWriteTokens, costUsd: costUsd ?? null, directory: null, title: null,
    };
    const identity = cursorIdentity(entry);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    records.push({ key: `v2:${identity}:${occurrence}`, entry, included });
  }
  if (!records.length && skipped) throw badCsv('no valid usage rows');
  return { records, skipped, zeroUsage, warnings, rows: rows.length };
}
