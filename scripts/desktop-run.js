import { spawn } from 'node:child_process';
import path from 'node:path';
import { options, output, exists, requireWindows, fail } from './desktop-common.js';

try {
  const opts = options();
  if (opts.help) console.log('Usage: npm run desktop:run -- [--arch x64|arm64] [--offline]');
  else {
    requireWindows();
    const executable = path.join(output(opts.arch), 'app', 'Toksight.Desktop.exe');
    if (!(await exists(executable))) throw new Error('Desktop build missing. Run npm run desktop:build first.');
    const child = spawn(executable, opts.offline ? ['--offline'] : [], {
      cwd: path.dirname(executable), detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.once('error', fail);
    child.once('spawn', () => { console.log(`Launched toksight desktop (PID ${child.pid})`); child.unref(); });
  }
} catch (error) { fail(error); }
