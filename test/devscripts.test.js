import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startNode, stopChild } from '../scripts/lib/process.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const dev = path.join(root, 'scripts', 'web-dev.js');

test('web development help works without starting a server', async () => {
  const { stdout } = await exec(process.execPath, [dev, '--help'], { timeout: 5000 });
  assert.match(stdout, /--api-port/);
  assert.match(stdout, /Ctrl\+C/);
});

test('web development rejects invalid or overlapping ports before startup', async () => {
  for (const args of [['--port', '0'], ['--api-port', '65536'], ['--port', '3000oops'], ['--port', '4729']]) {
    await assert.rejects(exec(process.execPath, [dev, ...args], { timeout: 5000 }), (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr, /must be (an integer|different)/);
      assert.doesNotMatch(err.stdout, /toksight web/);
      return true;
    });
  }
});

test('web build explains how to install missing dependencies in a fresh checkout', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'toksight-build-help-'));
  try {
    await cp(path.join(root, 'scripts'), path.join(temp, 'scripts'), { recursive: true });
    await cp(path.join(root, 'package.json'), path.join(temp, 'package.json'));
    await assert.rejects(exec(process.execPath, [path.join(temp, 'scripts', 'web-build.js')], { timeout: 5000 }), (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr, /npm run web:ci/);
      return true;
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('development process cleanup closes descendant listening sockets', { timeout: 15000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'toksight-dev-cleanup-'));
  const portFile = path.join(temp, 'port');
  const descendant = `
    const fs = require('node:fs');
    const file = process.argv[1];
    require('node:net').createServer().listen(0, '127.0.0.1', function () {
      const info = this.address();
      if (!info || !info.port) return;
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, String(info.port));
      fs.renameSync(tmp, file);
    });
  `;
  const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, ${JSON.stringify(portFile)}], { stdio: 'inherit' }); setInterval(() => {}, 1000);`;
  const child = startNode(['-e', parent], {
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();
  try {
    const deadline = Date.now() + 5000;
    let port = 0;
    while (port <= 0 && Date.now() < deadline) {
      try {
        port = Number(await readFile(portFile, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
      }
      if (port <= 0) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!(port > 0)) throw new Error(`Child did not start${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
    await stopChild(child, { tree: true });
    const probe = net.createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
  } finally {
    try {
      await stopChild(child, { tree: true });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
});
