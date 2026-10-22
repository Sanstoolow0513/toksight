// LiteLLM also lists resellers and cloud marketplaces. A provider ID alone is
// insufficient: Mistral and Alibaba both publish prices for third-party models.
const providers = {
  openai: { channel: 'openai', prefixes: ['openai'] },
  anthropic: { channel: 'anthropic', prefixes: ['anthropic'] },
  gemini: { channel: 'google', prefixes: ['gemini', 'google'] },
  google: { channel: 'google', prefixes: ['gemini', 'google'] },
  deepseek: { channel: 'deepseek', prefixes: ['deepseek'] },
  moonshot: { channel: 'moonshot', prefixes: ['moonshot'] },
  zai: { channel: 'zai', prefixes: ['zai'] },
  mistral: { channel: 'mistral', prefixes: ['mistral', 'codestral'], owns: /^(?:(?:open-)?(?:mistral|mixtral|codestral)|devstral|ministral|magistral|pixtral|voxtral|labs-leanstral)(?:-|$)/ },
  codestral: { channel: 'mistral', prefixes: ['codestral'], owns: /^codestral(?:-|$)/ },
  xai: { channel: 'xai', prefixes: ['xai'] },
  minimax: { channel: 'minimax', prefixes: ['minimax'] },
  dashscope: { channel: 'alibaba', prefixes: ['dashscope'], owns: /^qw(?:en|q)(?:[-\d.]|$)/ },
  qwen_ai_platform: { channel: 'alibaba', prefixes: ['qwen_ai_platform'], owns: /^qw(?:en|q)(?:[-\d.]|$)/ },
  alibaba: { channel: 'alibaba', prefixes: ['alibaba', 'qwen', 'dashscope', 'qwen_ai_platform'], owns: /^qw(?:en|q)(?:[-\d.]|$)/ },
  cohere_chat: { channel: 'cohere', prefixes: ['cohere', 'cohere_chat'] },
  cohere: { channel: 'cohere', prefixes: ['cohere', 'cohere_chat'] },
  ai21: { channel: 'ai21', prefixes: ['ai21'] },
};

export const FIRST_PARTY_PROVIDERS = [...new Set(Object.values(providers).map((row) => row.channel))];

export function firstPartyProvider(name, litellmProvider) {
  if (typeof name !== 'string' || typeof litellmProvider !== 'string') return null;
  const id = litellmProvider.toLowerCase();
  const provider = Object.hasOwn(providers, id) ? providers[id] : null;
  if (!provider) return null;
  let model = name.trim().toLowerCase();
  if (!model) return null;
  const slash = model.indexOf('/');
  if (slash >= 0) {
    if (!provider.prefixes.includes(model.slice(0, slash))) return null;
    model = model.slice(slash + 1);
    if (!model || model.includes('/')) return null;
  }
  if (provider.owns && !provider.owns.test(model)) return null;
  return provider.channel;
}

export function isFirstPartyPrice(record) {
  return Boolean(record && record.source === 'litellm' && (record.scope ?? 'default') === 'default' &&
    firstPartyProvider(record.name, record.provider) &&
    ['input', 'output', 'cacheRead', 'cacheWrite'].every((key) => Number.isFinite(record[key]) && record[key] >= 0));
}
