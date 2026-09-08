// Compatibility entry point; configuration responsibilities live in config/.
export { createAgentConfigService } from './config/inventory.js';
export { fileDefs } from './config/files.js';
export { redactConfig } from './config/redact.js';
export { PREVIEW_BYTES, MAX_READ_BYTES, MAX_MODELS } from './config/limits.js';
