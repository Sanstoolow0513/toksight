import { rmSync } from 'node:fs';
import path from 'node:path';
import { configDir } from './pricing.js';

// Only toksight's downloaded caches; pricing.json and providers.json are user settings.
export function resetPriceDatabase(database, context = {}) {
  for (const name of ['litellm-pricing.json', 'cursor-pricing.json']) {
    rmSync(path.join(configDir(context), 'cache', name), { force: true });
  }
  return { database: database.file, ...database.resetPrices() };
}
