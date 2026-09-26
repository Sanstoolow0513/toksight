import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compareVersions, readReleaseVersion } from './release-version.js';

const execFileAsync = promisify(execFile);

export function checkReleaseVersion(version, baseVersion) {
  const order = compareVersions(version, baseVersion);
  if (order < 0) throw new Error(`Release version ${version} is older than ${baseVersion}`);
  return order === 0 ? 'no version change' : `release ${version}`;
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const baseSha = process.env.RELEASE_BASE_SHA;
  if (!/^[a-f0-9]{40}$/.test(baseSha || '')) {
    throw new Error('RELEASE_BASE_SHA must be a full commit SHA');
  }
  const { stdout } = await execFileAsync('git', ['show', `${baseSha}:package.json`], { cwd: root });
  const baseVersion = JSON.parse(stdout).version;
  const version = await readReleaseVersion(root);
  console.log(checkReleaseVersion(version, baseVersion));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
