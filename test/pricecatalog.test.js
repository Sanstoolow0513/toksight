import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriceLookup, modelIdentity, priceRecord, reportModelName, storedPriceFor } from '../src/pricecatalog.js';
import { createUsageDatabase } from '../src/database.js';
import { buildCostCoverage } from '../src/costcoverage.js';

const rate = (name, input, provider = 'openai', source = 'litellm') => priceRecord({
  name, source, provider, input: input / 1e6, cacheRead: input / 1e6,
  cacheWrite: input / 1e6, output: input / 1e6,
});

test('report formatting preserves billing identities and dated model rates', () => {
  assert.equal(reportModelName('claude-opus-5-5', 'claude'), 'Claude Opus 5.5');
  assert.equal(reportModelName('anthropic/claude-opus-5-5-20260801', 'claude'), 'Claude Opus 5.5');
  assert.equal(reportModelName('gpt-5.6-sol', 'codex'), 'GPT-5.6 Sol');
  assert.equal(modelIdentity('gpt-5.6-sol-max').id, 'gpt-5.6-sol-max');
  const lookup = createPriceLookup([rate('gpt-example', 1), rate('gpt-example-20260101', 2)]);
  assert.equal(lookup('gpt-example').input, 1e-6);
  assert.equal(lookup('gpt-example-20260101').input, 2e-6);
  assert.equal(lookup('gpt-example-fast'), null);
});

test('first-party provider identity constrains aliases and stored estimates', () => {
  const gemini = rate('gemini/gemini-example', 2, 'google');
  const lookup = createPriceLookup([gemini, rate('gpt-example', 1)]);
  assert.equal(lookup('google/gemini-example'), gemini);
  assert.equal(lookup('gemini-example', 'opencode', { providerId: 'google' }), gemini);
  for (const providerId of ['openai', 'proxy', 'openrouter']) {
    assert.equal(lookup('gemini-example', 'opencode', { providerId }), null);
    assert.equal(storedPriceFor('gemini-example', gemini, { providerId }), null);
  }
  assert.equal(lookup('openrouter/google/gemini-example'), null);
  for (const model of ['openrouter/google/gemini-example', 'other/gemini-example', 'deepinfra/google/gemini-example']) {
    assert.equal(storedPriceFor(model, gemini), null, model);
  }
  const custom = rate('gemini-example', 3, null, 'user');
  assert.equal(createPriceLookup([gemini, custom])('gemini-example', 'opencode', { providerId: 'proxy' }), custom);
});

test('equivalent first-party Alibaba table namespaces share safe aliases; different prices stay ambiguous', () => {
  const a = rate('dashscope/qwen-example', 1, 'alibaba');
  const b = rate('qwen_ai_platform/qwen-example', 1, 'alibaba');
  const lookup = createPriceLookup([a, b]);
  assert.equal(lookup('qwen-example').input, 1e-6);
  assert.equal(lookup('alibaba/qwen-example').input, 1e-6);
  for (const providerId of ['dashscope', 'qwen_ai_platform', 'qwen', 'alibaba']) {
    assert.equal(lookup('qwen-example', 'opencode', { providerId }).input, 1e-6);
  }
  assert.equal(createPriceLookup([a, { ...b, input: 2e-6 }])('qwen-example'), null);
  for (const [name, providerId, provider] of [['codestral-example', 'codestral', 'mistral'], ['command-example', 'cohere_chat', 'cohere']]) {
    assert.ok(createPriceLookup([rate(name, 1, provider)])(name, 'opencode', { providerId }));
  }
});

test('ambiguous bare model names never pick another provider by catalog order', () => {
  const a = rate('openai/shared', 1), b = rate('anthropic/shared', 2, 'anthropic');
  for (const records of [[a, b], [b, a]]) {
    const lookup = createPriceLookup(records);
    assert.equal(lookup('shared'), null);
    assert.equal(lookup('openai/shared'), a);
    assert.equal(lookup('shared', 'opencode', { providerId: 'anthropic' }), b);
  }
});

test('different prices on dedicated Codestral and Mistral tables require an explicit catalog name', () => {
  const dedicated = rate('codestral/codestral-latest', 0, 'mistral');
  const api = rate('mistral/codestral-latest', 0.3, 'mistral');
  const lookup = createPriceLookup([dedicated, api]);
  assert.equal(lookup('codestral-latest'), null);
  assert.equal(lookup(dedicated.name), dedicated);
  assert.equal(lookup(api.name), api);
});

test('price updates preserve observed historical estimates and reported charges; older downloads cannot replace newer ones', () => {
  const db = createUsageDatabase({ file: ':memory:' });
  try {
    const estimated = { client: 'codex', model: 'gpt-example', sessionId: 'one', timestamp: 1,
      inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      reasoningTokens: 0, costUsd: 8, directory: null, title: null };
    const reported = { ...estimated, client: 'opencode', sessionId: 'two', costUsd: 7 };
    const old = [rate('gpt-example', 8)];
    db.replace({ entries: [estimated, reported], warnings: [], reportedCosts: new WeakSet([reported]),
      pricing: { priceFor: createPriceLookup(old), records: old, sources: { litellm: 'fresh' }, configDir: '/fixture' } }, '2026-09-23T00:00:00.000Z');
    const details = (date) => ({ litellm: { fetchedAt: date, state: 'refreshed', url: 'https://github.com/BerriAI/litellm' } });
    db.updatePriceCatalog({ records: [rate('gpt-example', 9)], sources: ['litellm'], sourceDetails: details('2026-09-24T00:00:00.000Z') });
    assert.equal(db.read().entries[0].costUsd, 8);
    assert.equal(db.read().entries[1].costUsd, 7);
    assert.equal(db.read().pricing.priceFor('gpt-example').input, 9e-6);
    assert.equal(buildCostCoverage(db.read().entries, db.read()).sources.litellm.requests, 1);
    db.updatePriceCatalog({ records: old, sources: ['litellm'], sourceDetails: details('2026-09-23T00:00:00.000Z') });
    assert.equal(db.read().pricing.priceFor('gpt-example').input, 9e-6);
  } finally { db.close(); }
});
