// Standard LiteLLM context-length prices only. Cache duration and service
// tiers are separate billing dimensions and are deliberately not inferred.
const RATE_KEYS = {
  input: 'input_cost_per_token', output: 'output_cost_per_token',
  cacheRead: 'cache_read_input_token_cost', cacheWrite: 'cache_creation_input_token_cost',
};
const nonnegative = (value) => Number.isFinite(value) && value >= 0;

export function litellmContextTiers(model) {
  const tiers = new Map();
  for (const key of Object.keys(model)) {
    const match = /^input_cost_per_token_above_(\d+)(k?)_tokens$/.exec(key);
    if (!match || !nonnegative(model[key])) continue;
    const contextOver = Number(match[1]) * (match[2] ? 1000 : 1);
    if (!Number.isSafeInteger(contextOver) || contextOver <= 0) continue;
    const suffix = key.slice('input_cost_per_token'.length);
    const values = Object.fromEntries(Object.entries(RATE_KEYS).map(([part, field]) => [part, model[field + suffix] ?? model[field]]));
    const tier = { contextOver, input: values.input, output: values.output,
      cacheRead: values.cacheRead ?? values.input, cacheWrite: values.cacheWrite ?? values.input,
      cacheReadFallback: values.cacheRead == null, cacheWriteFallback: values.cacheWrite == null,
      // LiteLLM uses inclusive context thresholds for xAI's direct API.
      ...(model.litellm_provider === 'xai' ? { inclusive: true } : {}) };
    if (Object.keys(RATE_KEYS).every((part) => nonnegative(tier[part]))) tiers.set(contextOver, tier);
  }
  return [...tiers.values()].sort((a, b) => a.contextOver - b.contextOver);
}

export function validContextTiers(value) {
  return value == null || (Array.isArray(value) && value.every((tier, i) =>
    tier && typeof tier === 'object' && !Array.isArray(tier) &&
    Number.isSafeInteger(tier.contextOver) && tier.contextOver > 0 &&
    (i === 0 || tier.contextOver > value[i - 1].contextOver) &&
    Object.keys(RATE_KEYS).every((part) => nonnegative(tier[part])) &&
    typeof tier.cacheReadFallback === 'boolean' && typeof tier.cacheWriteFallback === 'boolean' &&
    (tier.inclusive === undefined || typeof tier.inclusive === 'boolean')));
}

export function priceForContext(record, entry) {
  if (!entry || !record?.contextTiers?.length) return record;
  const input = entry.inputTokens + entry.cacheReadTokens + entry.cacheWriteTokens;
  if (!Number.isFinite(input)) return record;
  for (let i = record.contextTiers.length - 1; i >= 0; i--) {
    const tier = record.contextTiers[i];
    if (input > tier.contextOver || (tier.inclusive && input === tier.contextOver)) return { ...record, ...tier };
  }
  return record;
}
