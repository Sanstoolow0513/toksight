// Model author AND endpoint operator must agree. Unknown operators are skipped.
export const NATIVE_PROVIDERS = {
  openai: { channel: 'openai', names: ['OpenAI'], tags: ['openai'] },
  anthropic: { channel: 'anthropic', names: ['Anthropic'], tags: ['anthropic'] },
  google: { channel: 'google', names: ['Google', 'Google AI Studio', 'Google Vertex'], tags: ['google-ai-studio', 'google-vertex'] },
  'x-ai': { channel: 'xai', names: ['xAI'], tags: ['xai'] },
  deepseek: { channel: 'deepseek', names: ['DeepSeek'], tags: ['deepseek'] },
  moonshotai: { channel: 'moonshot', names: ['Moonshot AI', 'MoonshotAI'], tags: ['moonshotai'] },
  qwen: { channel: 'alibaba', names: ['Alibaba'], tags: ['alibaba'] },
  'z-ai': { channel: 'zai', names: ['Z.AI'], tags: ['z-ai'] },
  minimax: { channel: 'minimax', names: ['Minimax'], tags: ['minimax'] },
  mistralai: { channel: 'mistral', names: ['Mistral'], tags: ['mistral'] },
  cohere: { channel: 'cohere', names: ['Cohere'], tags: ['cohere'] },
  ai21: { channel: 'ai21', names: ['AI21'], tags: ['ai21'] },
};
export const NATIVE_CHANNELS = [...new Set(Object.values(NATIVE_PROVIDERS).map((row) => row.channel))];
export function nativeEndpoint(model, endpoint) {
  const owner = NATIVE_PROVIDERS[model.split('/')[0]];
  return owner && owner.names.some((name) => name.toLowerCase() === endpoint.provider_name?.toLowerCase()) &&
    owner.tags.includes(endpoint.tag?.split('/')[0]) ? owner : null;
}
export function nativeChannel(provider) {
  return ({ gemini: 'google', 'x-ai': 'xai', moonshotai: 'moonshot', qwen: 'alibaba', 'z-ai': 'zai', zhipuai: 'zai', mistralai: 'mistral' })[provider] ?? provider;
}
