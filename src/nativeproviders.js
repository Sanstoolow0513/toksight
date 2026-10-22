import { FIRST_PARTY_PROVIDERS } from './firstparty.js';

export const NATIVE_CHANNELS = FIRST_PARTY_PROVIDERS;
export function nativeChannel(provider) {
  return ({ gemini: 'google', 'x-ai': 'xai', moonshotai: 'moonshot', qwen: 'alibaba', dashscope: 'alibaba',
    qwen_ai_platform: 'alibaba', 'z-ai': 'zai', zhipuai: 'zai', mistralai: 'mistral', codestral: 'mistral', cohere_chat: 'cohere' })[provider] ?? provider;
}
