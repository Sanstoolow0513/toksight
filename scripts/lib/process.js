import { spawn } from 'node:child_process';

// Invoke JavaScript entry points directly: no npm.cmd shell quoting on Windows.
export function startNode(args, options = {}) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', ...options });
  child.done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  // A caller may still be waiting for an HTTP readiness probe when spawn fails.
  child.done.catch(() => {});
  return child;
}

export async function stopChild(child, { tree = false } = {}) {
  if (!child?.pid || child.exitCode != null || child.signalCode != null) return;
  if (tree && process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('error', reject);
      killer.once('exit', (code) => {
        if (code === 0 || child.exitCode != null || child.signalCode != null) resolve();
        else reject(new Error(`Could not stop development process tree (${child.pid})`));
      });
    });
  } else {
    const kill = (signal) => {
      try {
        if (tree) process.kill(-child.pid, signal); // detached POSIX process group
        else child.kill(signal);
      } catch (err) {
        if (err.code !== 'ESRCH') throw err;
      }
    };
    kill('SIGTERM');
    const timer = setTimeout(() => kill('SIGKILL'), 5000);
    try { await child.done; } finally { clearTimeout(timer); }
  }
  await child.done;
}

export async function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this check with `npm run check:package`.');
  const { code, signal } = await startNode([npmCli, ...args], options).done;
  if (code !== 0) throw new Error(`npm ${args[0]} failed (${signal || code})`);
}
