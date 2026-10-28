import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_PARTY_PROVIDERS, firstPartyProvider, isFirstPartyPrice } from '../src/firstparty.js';

test('LiteLLM first-party provider IDs map to the native API channels', () => {
  const rows = [
    ['gpt-6.1-sol', 'openai', 'openai'], ['ft:gpt-4.1-2025-04-14', 'openai', 'openai'],
    ['claude-opus-5-5', 'anthropic', 'anthropic'], ['gemini/gemini-3.8-flash', 'gemini', 'google'],
    ['deepseek/deepseek-v4-pro', 'deepseek', 'deepseek'], ['moonshot/kimi-k3', 'moonshot', 'moonshot'],
    ['zai/glm-5.3', 'zai', 'zai'], ['mistral/devstral-medium-latest', 'mistral', 'mistral'],
    ['codestral/codestral-latest', 'codestral', 'mistral'], ['mistral/labs-leanstral-1-5', 'mistral', 'mistral'],
    ['xai/grok-4.7', 'xai', 'xai'], ['minimax/MiniMax-M3', 'minimax', 'minimax'],
    ['dashscope/qwen3.8-max', 'dashscope', 'alibaba'], ['qwen_ai_platform/qwq-plus', 'qwen_ai_platform', 'alibaba'],
    ['command-a-plus-05-2026', 'cohere_chat', 'cohere'], ['jamba-large-1.7', 'ai21', 'ai21'],
  ];
  for (const [name, raw, expected] of rows) assert.equal(firstPartyProvider(name, raw), expected, name);
  assert.equal(new Set(FIRST_PARTY_PROVIDERS).size, 12);
});

test('marketplace prices and hosted third-party models never become native prices', () => {
  const rows = [
    ['deepinfra/moonshotai/Kimi-K3', 'deepinfra'], ['openrouter/openai/gpt-6.1-sol', 'openrouter'],
    ['azure/gpt-6.1-sol', 'azure'], ['vertex_ai/gemini-3.8-flash', 'vertex_ai'],
    ['gemini-2.5-pro', 'vertex_ai-language-models'], ['qwencloud/qwen-max', 'qwencloud'],
    ['mistral/zai-glm-5-3', 'mistral'], ['mistral/glm-5-2', 'mistral'],
    ['dashscope/deepseek-v4-pro', 'dashscope'], ['dashscope/glm-5.2', 'dashscope'],
    ['qwen_ai_platform/kimi-k2.7-code', 'qwen_ai_platform'],
    ['openai/gpt-6.1-sol', 'deepseek'], ['unknown/gpt-6.1-sol', 'openai'],
    ['openai/other/gpt-6.1-sol', 'openai'], ['', 'openai'], ['gpt-6.1-sol', null],
  ];
  for (const [name, provider] of rows) assert.equal(firstPartyProvider(name, provider), null, `${provider}: ${name}`);
});

test('stored first-party records retain canonical providers and reject legacy sources and bad rates', () => {
  const base = { source: 'litellm', scope: 'default', name: 'gemini/gemini-3.8-flash', provider: 'google',
    input: 1e-6, output: 2e-6, cacheRead: 0, cacheWrite: 1e-6 };
  for (const [name, provider] of [['mistral/codestral-latest', 'mistral'], ['dashscope/qwen-max', 'alibaba'],
    ['qwen_ai_platform/qwen-max', 'alibaba'], ['command-a-plus-05-2026', 'cohere'], [base.name, base.provider]]) {
    assert.equal(isFirstPartyPrice({ ...base, name, provider }), true, name);
  }
  for (const changed of [{ source: 'openrouter-native' }, { source: 'cursor' }, { scope: 'cursor' },
    { provider: null }, { input: -1 }, { output: Infinity }, { cacheRead: undefined },
    { name: 'dashscope/deepseek-v4-pro', provider: 'alibaba' }]) {
    assert.equal(isFirstPartyPrice({ ...base, ...changed }), false, JSON.stringify(changed));
  }
  assert.equal(isFirstPartyPrice(null), false);
});
