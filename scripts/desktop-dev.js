import { prepareDesktop } from './desktop-build.js';
import { desktop, fail, options, run, tauriCli, target } from './desktop-common.js';

try {
  const opts = options();
  if (opts.help) console.log('Usage: npm run desktop:dev -- [--arch x64|arm64] [--offline]');
  else {
    await prepareDesktop(opts);
    await run(process.execPath, [tauriCli, 'dev', '--target', target(opts.arch), '--', '--locked', ...(opts.offline ? ['--', '--offline'] : [])], { cwd: desktop });
  }
} catch (error) { fail(error); }
