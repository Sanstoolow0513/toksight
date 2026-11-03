import { options, prepareRuntime, fail } from './desktop-common.js';
try {
  const opts = options();
  if (opts.help) console.log('Usage: npm run desktop:runtime -- [--arch x64|arm64] [--runtime <official-node.zip>]');
  else await prepareRuntime(opts);
} catch (error) { fail(error); }
