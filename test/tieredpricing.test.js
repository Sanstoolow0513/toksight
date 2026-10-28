import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLitellmPrice, priceForContext, validContextTiers } from '../src/contextpricing.js';

// LiteLLM's dashscope/qwen3-coder-plus range table (2026-10-20).
const coder = { tiered_pricing: [
  { range: [0, 32000], input_cost_per_token: 1e-6, output_cost_per_token: 5e-6, cache_read_input_token_cost: 1e-7 },
  { range: [32000, 128000], input_cost_per_token: 1.8e-6, output_cost_per_token: 9e-6, cache_read_input_token_cost: 1.8e-7 },
  { range: [128000, 256000], input_cost_per_token: 3e-6, output_cost_per_token: 15e-6, cache_read_input_token_cost: 3e-7 },
  { range: [256000, 1000000], input_cost_per_token: 6e-6, output_cost_per_token: 60e-6, cache_read_input_token_cost: 6e-7 },
] };
const request = (inputTokens, extra = {}) => ({ inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 9999999, ...extra });

test('tier-only Qwen prices select one full-request tier with inclusive upper boundaries', () => {
  const price = normalizeLitellmPrice(coder);
  assert.equal(validContextTiers(price.contextTiers), true);
  assert.deepEqual(price.contextTiers.map((tier) => tier.contextOver), [32000, 128000, 256000]);
  for (const [tokens, expected] of [[0, 1e-6], [32000, 1e-6], [32001, 1.8e-6], [128000, 1.8e-6],
    [128001, 3e-6], [256000, 3e-6], [256001, 6e-6], [1000000, 6e-6], [1000001, 6e-6]]) {
    assert.equal(priceForContext(price, request(tokens)).input, expected, String(tokens));
  }
  const cached = priceForContext(price, request(30000, { cacheReadTokens: 2000, cacheWriteTokens: 1 }));
  assert.deepEqual([cached.input, cached.output, cached.cacheRead, cached.cacheWrite], [1.8e-6, 9e-6, 1.8e-7, 1.8e-6]);
  assert.equal(cached.cacheReadFallback, false);
  assert.equal(cached.cacheWriteFallback, true);
  assert.equal(priceForContext(price, request(30000)).input, 1e-6, 'output does not choose a prompt tier');
  assert.equal(priceForContext(price, null), price, 'catalog reads return the base price');
});

test('range tables sort without mutation and use per-tier cache fallbacks including explicit free rates', () => {
  const raw = { input_cost_per_token: 99, output_cost_per_token: 7,
    cache_read_input_token_cost: 88, cache_creation_input_token_cost: 77,
    tiered_pricing: [
      { range: [100, 200], input_cost_per_token: 3 },
      { range: [0, 100], input_cost_per_token: 1, output_cost_per_token: 2,
        cache_read_input_token_cost: 0, cache_creation_input_token_cost: 0 },
    ] };
  const copy = structuredClone(raw);
  const price = normalizeLitellmPrice(raw);
  assert.deepEqual(raw, copy);
  assert.deepEqual([price.input, price.output, price.cacheRead, price.cacheWrite], [1, 2, 0, 0]);
  const long = priceForContext(price, request(101));
  assert.deepEqual([long.input, long.output, long.cacheRead, long.cacheWrite], [3, 7, 3, 3]);
  assert.equal(long.cacheReadFallback, true);
  assert.equal(long.cacheWriteFallback, true);
});

test('malformed, partial, overlapping, gapped and unsafe range tables never fabricate a base price', () => {
  const tier = (start, end, extra = {}) => ({ range: [start, end], input_cost_per_token: 1, output_cost_per_token: 2, ...extra });
  const tables = [[], {}, [null], [tier(0, 100), tier(90, 200)], [tier(0, 100), tier(101, 200)],
    [tier(1, 100)], [tier(-1, 100)], [tier(0, 0)], [tier(100, 10)], [tier(0, Infinity)],
    [tier(0, Number.MAX_SAFE_INTEGER + 1)], [tier(0, 10.5)], [tier(0, 100, { range: [0, 100, 200] })],
    [tier(0, 100, { range: ['0', 100] })], [tier(0, 100), tier(0, 100)],
    [tier(0, 100, { input_cost_per_token: undefined })], [tier(0, 100, { output_cost_per_token: undefined })],
    [tier(0, 100, { cache_read_input_token_cost: -1 })], [tier(0, 100, { cache_creation_input_token_cost: '1e-6' })],
  ];
  for (const tiered_pricing of tables) {
    assert.equal(normalizeLitellmPrice({ tiered_pricing }), null, JSON.stringify(tiered_pricing));
  }
  assert.equal(normalizeLitellmPrice({ input_cost_per_token: 1, output_cost_per_token: 2, tiered_pricing: [] }), null);
});

test('flat and standard above_N prices keep their existing cache and threshold behavior', () => {
  const price = normalizeLitellmPrice({ litellm_provider: 'xai', input_cost_per_token: 1,
    output_cost_per_token: 2, cache_read_input_token_cost: 0,
    input_cost_per_token_above_100k_tokens: 3,
    input_cost_per_token_above_200k_tokens: -1 });
  assert.deepEqual([price.input, price.output, price.cacheRead, price.cacheWrite], [1, 2, 0, 1]);
  assert.equal(price.contextTiers.length, 1);
  const tier = priceForContext(price, request(100000));
  assert.deepEqual([tier.input, tier.output, tier.cacheRead, tier.cacheWrite], [3, 2, 0, 3]);
  assert.equal(tier.inclusive, true);
  assert.equal(normalizeLitellmPrice({ input_cost_per_token: 1 }), null);
  assert.equal(normalizeLitellmPrice(null), null);
});
