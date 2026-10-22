// Standard LiteLLM context-length prices only. Cache duration and service
// tiers are separate billing dimensions and are deliberately not inferred.
const RATE_KEYS = {
  input: 'input_cost_per_token', output: 'output_cost_per_token',
  cacheRead: 'cache_read_input_token_cost', cacheWrite: 'cache_creation_input_token_cost',
};
const nonnegative = (value) => Number.isFinite(value) && value >= 0;

// LiteLLM's range tables choose one rate for the entire request, including its
// output: start < prompt tokens <= end. The last rate also covers longer input.
// See litellm_core_utils/llm_cost_calc/tiered_pricing.py in the upstream project.
export function normalizeLitellmPrice(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return null;
  if (model.tiered_pricing != null) {
    const raw = model.tiered_pricing;
    if (!Array.isArray(raw) || !raw.length || raw.some((tier) => !tier ||
      typeof tier !== 'object' || Array.isArray(tier) || !Array.isArray(tier.range) || tier.range.length !== 2 ||
      !tier.range.every(Number.isSafeInteger) || tier.range[0] < 0 || tier.range[1] <= tier.range[0])) return null;
    const sorted = [...raw].sort((a, b) => a.range[0] - b.range[0]);
    if (sorted[0].range[0] !== 0 || sorted.some((tier, i) => i > 0 && tier.range[0] !== sorted[i - 1].range[1])) return null;
    const rates = sorted.map((tier) => ({
      input: tier.input_cost_per_token,
      output: tier.output_cost_per_token ?? model.output_cost_per_token,
      // Unlike above_N fields, a range tier's cache fallback is its own input
      // rate, even when the top-level model publishes a different cache rate.
      cacheRead: tier.cache_read_input_token_cost ?? tier.input_cost_per_token,
      cacheWrite: tier.cache_creation_input_token_cost ?? tier.input_cost_per_token,
      cacheReadFallback: tier.cache_read_input_token_cost == null,
      cacheWriteFallback: tier.cache_creation_input_token_cost == null,
    }));
    if (rates.some((tier) => Object.keys(RATE_KEYS).some((part) => !nonnegative(tier[part])))) return null;
    return { ...rates[0], contextTiers: rates.slice(1).map((tier, i) => ({ contextOver: sorted[i + 1].range[0], ...tier })) };
  }
  const base = {
    input: model.input_cost_per_token, output: model.output_cost_per_token,
    cacheRead: model.cache_read_input_token_cost ?? model.input_cost_per_token,
    cacheWrite: model.cache_creation_input_token_cost ?? model.input_cost_per_token,
    cacheReadFallback: model.cache_read_input_token_cost == null,
    cacheWriteFallback: model.cache_creation_input_token_cost == null,
  };
  if (Object.keys(RATE_KEYS).some((part) => !nonnegative(base[part]))) return null;
  return { ...base, contextTiers: litellmContextTiers(model) };
}

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
