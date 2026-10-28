// Provider display names and logos (LobeHub icons, MIT; see public/logos/).
// `mono` logos are single-colour marks drawn in the current text colour.
export const PROVIDERS = {
  openai: { name: 'OpenAI', logo: 'openai', mono: true },
  anthropic: { name: 'Anthropic', logo: 'anthropic', mono: true },
  google: { name: 'Google', logo: 'google-color' },
  moonshot: { name: 'Moonshot AI · Kimi', key: 'provider_moonshot', logo: 'moonshot', mono: true },
  zai: { name: 'Z.ai · Zhipu GLM', key: 'provider_zai', logo: 'zai', mono: true },
  deepseek: { name: 'DeepSeek', logo: 'deepseek-color' },
  alibaba: { name: 'Alibaba · Qwen', key: 'provider_alibaba', logo: 'qwen-color' },
  mistral: { name: 'Mistral', logo: 'mistral-color' },
  xai: { name: 'xAI', logo: 'xai', mono: true },
  minimax: { name: 'MiniMax', logo: 'minimax-color' },
  cohere: { name: 'Cohere', logo: 'cohere-color' },
  ai21: { name: 'AI21', logo: 'ai21', mono: true },
};
// Model families override the provider mark on cards.
const FAMILIES = [['claude', 'claude-color', false], ['gemini', 'gemini-color', false], ['kimi', 'kimi-color', false], ['grok', 'grok', true]];

const names = { ...Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, p.name])), litellm: 'LiteLLM' };
export const priceSourceLabel = (source, tx) => names[source] ?? (source === 'user' ? tx('sourceUser') : source);

// Section titles use the full name; chips use the part before " · ".
export function providerName(id, tx, short = false) {
  const entry = PROVIDERS[id];
  const full = entry?.key ? tx(entry.key) : entry?.name ?? (id || tx('priceOtherProvider'));
  return short ? full.split(' · ')[0] : full;
}

export function providerLogo(id) {
  const entry = PROVIDERS[id];
  return entry ? { file: entry.logo, mono: Boolean(entry.mono) } : null;
}

export function modelLogo(record) {
  const base = String(record?.name ?? '').split('/').pop().toLowerCase();
  const family = FAMILIES.find(([prefix]) => base.startsWith(prefix));
  return family ? { file: family[1], mono: family[2] } : providerLogo(record?.provider);
}

// USD per million tokens: at least 2 decimals, up to 4 when needed ($10.00,
// $0.275, $15.625, $0.0375); free is $0 and sub-cent-hundredth rates <$0.0001.
const unitFormats = [2, 3, 4].map((digits) => new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
export function fmtUnitPrice(rate) {
  if (!Number.isFinite(rate)) return '—';
  const value = rate * 1e6;
  if (value === 0) return '$0';
  if (Math.abs(value) < 0.00005) return '<$0.0001';
  for (const [i, format] of unitFormats.entries()) {
    const digits = i + 2;
    if (i === unitFormats.length - 1 || Math.abs(Number(value.toFixed(digits)) - value) < 1e-9) return '$' + format.format(value);
  }
  return '—';
}

// Compact context thresholds: 272000 → 272K, 1048576 → 1M.
export function fmtTokenLimit(n) {
  return n >= 1e6 ? `${Math.round(n / 1048576)}M` : `${Math.round(n / 1000)}K`;
}

export function priceSourceUrl(record, update) {
  const url = record?.official?.url ?? update?.url;
  try { return new URL(url).protocol === 'https:' ? url : null; }
  catch { return null; }
}
