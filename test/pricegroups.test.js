import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createUsageDatabase } from '../src/database.js';
import { priceRecord } from '../src/pricecatalog.js';
import { groupPriceRecords, priceBaseName } from '../src/pricegroups.js';

const rate = (name, provider, input, extra = {}) => ({
  ...priceRecord({ source: 'litellm', provider, name, input, output: input * 5, cacheRead: input / 10, cacheWrite: 0 }),
  id: `${provider}:${name}`, ...extra,
});

test('priceBaseName drops provider prefixes, :latest and dated snapshot suffixes', () => {
  assert.equal(priceBaseName('dashscope/qwen-flash-2025-07-28'), 'qwen-flash');
  assert.equal(priceBaseName('claude-opus-4-7-20260416'), 'claude-opus-4-7');
  assert.equal(priceBaseName('gpt-5.5-2026-04-23'), 'gpt-5.5');
  assert.equal(priceBaseName('kimi-k3:latest'), 'kimi-k3');
  assert.equal(priceBaseName('gpt-4o-mini'), 'gpt-4o-mini');
});

test('groupPriceRecords merges same-priced aliases only and lists used models first', () => {
  const rows = [
    rate('claude-opus-4-7-20260416', 'anthropic', 5e-6),
    rate('claude-opus-4-7', 'anthropic', 5e-6),
    rate('dashscope/qwen-coder', 'alibaba', 1e-6),
    rate('qwen_ai_platform/qwen-coder', 'alibaba', 1e-6),
    rate('gpt-5.5', 'openai', 2e-6),
    rate('gpt-5.5-2026-04-23', 'openai', 3e-6),
  ];
  const models = groupPriceRecords(rows, new Set(['openai:gpt-5.5-2026-04-23']));
  assert.deepEqual(models.map(m => m.name), ['gpt-5.5-2026-04-23', 'claude-opus-4-7', 'dashscope/qwen-coder', 'gpt-5.5']);
  assert.deepEqual(models.map(m => m.used), [true, false, false, false]);
  const opus = models.find(m => m.name === 'claude-opus-4-7');
  assert.deepEqual(opus.names, ['claude-opus-4-7', 'claude-opus-4-7-20260416']);
  assert.deepEqual(opus.ids.sort(), ['anthropic:claude-opus-4-7', 'anthropic:claude-opus-4-7-20260416']);
  assert.equal(models.find(m => m.name === 'dashscope/qwen-coder').names.length, 2);
  // Different context tiers keep rows apart even when base rates match.
  const tiered = groupPriceRecords([rate('m', 'openai', 1e-6), rate('m-2026-01-01', 'openai', 1e-6, { contextTiers: [{ contextOver: 200000, input: 2e-6 }] })]);
  assert.equal(tiered.length, 2);
});

test('price catalog adds one-row-per-model `models` with used flags and drops legacy source rows', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-pricegroups-'));
  const file = path.join(dir, 'usage.sqlite');
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const make = (name, input) => priceRecord({ source: 'litellm', provider: 'openai', name, input, output: 0, cacheRead: 0, cacheWrite: 0 });
  let db = createUsageDatabase({ file });
  try {
    db.replace({ entries: [{ client: 'codex', sessionId: 's', model: 'gpt-example', timestamp: Date.now(), inputTokens: 10, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, directory: 'C:\\fixture', title: 'Example' }],
      warnings: [], reportedCosts: new WeakSet(), pricing: { sources: {}, configDir: '/fixture', priceFor: () => null } });
    db.updatePriceCatalog({ records: [make('gpt-example', 1e-6), make('gpt-example-2026-01-01', 1e-6), make('gpt-other', 4e-6)], sources: ['litellm'], sourceDetails: {} }, '2026-09-08T12:00:00.000Z');
    const catalog = db.priceCatalog();
    assert.equal(catalog.records.length, 3);
    assert.deepEqual(catalog.models.map(m => [m.name, m.used, m.names.length]), [['gpt-example', true, 2], ['gpt-other', false, 1]]);
  } finally { db.close(); }
  const raw = new DatabaseSync(file);
  try {
    raw.exec("CREATE TEMP TABLE legacy AS SELECT * FROM model_prices LIMIT 1; UPDATE legacy SET source = 'openai', id = NULL; INSERT INTO model_prices SELECT * FROM legacy;");
    assert.equal(raw.prepare("SELECT count(*) n FROM model_prices WHERE source = 'openai'").get().n, 1);
  } finally { raw.close(); }
  db = createUsageDatabase({ file });
  db.close();
  const check = new DatabaseSync(file);
  try { assert.equal(check.prepare("SELECT count(*) n FROM model_prices WHERE source NOT IN ('litellm', 'user')").get().n, 0); }
  finally { check.close(); }
});

test('groupPriceRecords lists the log model names each group priced as usedAs', () => {
  const rows = [rate('claude-opus-4-7-20260416', 'anthropic', 5e-6), rate('claude-opus-4-7', 'anthropic', 5e-6), rate('gpt-5.5', 'openai', 2e-6)];
  const used = new Map([['anthropic:claude-opus-4-7', new Set(['claude-opus-4-7'])], ['anthropic:claude-opus-4-7-20260416', new Set(['claude-opus-4-7-20260416', 'anthropic/claude-opus-4-7'])]]);
  const models = groupPriceRecords(rows, used);
  const opus = models.find((m) => m.name === 'claude-opus-4-7');
  assert.equal(opus.used, true);
  assert.deepEqual(opus.usedAs, ['anthropic/claude-opus-4-7', 'claude-opus-4-7', 'claude-opus-4-7-20260416']);
  assert.deepEqual(models.find((m) => m.name === 'gpt-5.5').usedAs, []);
  // A plain Set (older callers) still marks use and leaves usedAs empty.
  assert.deepEqual(groupPriceRecords(rows, new Set(['openai:gpt-5.5'])).map((m) => [m.name, m.used, m.usedAs]),
    [['gpt-5.5', true, []], ['claude-opus-4-7', false, []]]);
});

test('price catalog models carry context limits and the log names they priced', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'toksight-pricelimits-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const make = (name, extra = {}) => priceRecord({ source: 'litellm', provider: 'openai', name, input: 1e-6, output: 0, cacheRead: 0, cacheWrite: 0, ...extra });
  const db = createUsageDatabase({ file: path.join(dir, 'usage.sqlite') });
  try {
    const entry = (model) => ({ client: 'codex', sessionId: 's', model, timestamp: Date.now(), inputTokens: 10, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, directory: null, title: null });
    db.replace({ entries: [entry('gpt-example'), entry('GPT-Example-2026-01-01')], warnings: [], reportedCosts: new WeakSet(), pricing: { sources: {}, configDir: '/fixture', priceFor: () => null } });
    db.updatePriceCatalog({ records: [make('gpt-example', { maxInputTokens: 272000, maxTokens: 128000 }), make('gpt-example-2026-01-01', { maxInputTokens: 272000 })], sources: ['litellm'], sourceDetails: {} }, '2026-09-08T12:00:00.000Z');
    const catalog = db.priceCatalog();
    const record = catalog.records.find((r) => r.name === 'gpt-example');
    assert.equal(record.maxInputTokens, 272000);
    assert.equal(record.maxTokens, 128000);
    const [model] = catalog.models;
    assert.equal(model.maxInputTokens, 272000);
    assert.deepEqual(model.usedAs, ['GPT-Example-2026-01-01', 'gpt-example']);
    // A later catalog that only changes context limits is not a new rate revision.
    db.updatePriceCatalog({ records: [make('gpt-example', { maxInputTokens: 400000 }), make('gpt-example-2026-01-01')], sources: ['litellm'], sourceDetails: {} }, '2026-09-09T12:00:00.000Z');
    const next = db.priceCatalog();
    assert.equal(next.records.find((r) => r.name === 'gpt-example').maxInputTokens, 400000);
    assert.equal(next.records.find((r) => r.name === 'gpt-example').revisions, 1);
    assert.equal(next.records.find((r) => r.name === 'gpt-example-2026-01-01').maxInputTokens, undefined);
  } finally { db.close(); }
});
