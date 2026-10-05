const names = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek', moonshot: 'Moonshot', zai: 'Z.AI', qwen: 'Qwen', openrouter: 'OpenRouter', cursor: 'Cursor', litellm: 'LiteLLM' };
export const priceSourceLabel = (source, tx) => (source === 'openrouter-native' ? tx('priceNativeRouter') : names[source]) ?? (source === 'user' ? tx('sourceUser') : source);

// Token rates can be tiny: keep precision instead of formatting as usage cost.
const units = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 12 });
export function fmtUnitPrice(rate) {
  return Number.isFinite(rate) ? '$' + units.format(rate * 1e6) : '—';
}

export function priceSourceUrl(record, update) {
  const url = record?.official?.url ?? record?.cursor?.url ?? update?.url;
  try { return new URL(url).protocol === 'https:' ? url : null; }
  catch { return null; }
}
