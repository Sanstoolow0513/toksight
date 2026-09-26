import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bumpReleaseVersion } from '../scripts/release-version.js';

async function makeReleaseFiles(t, version = '0.4.0') {
  const root = await mkdtemp(join(tmpdir(), 'toksight-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'web'));
  for (const prefix of ['', 'web/']) {
    const name = prefix ? 'toksight-web' : 'toksight';
    await writeFile(join(root, prefix, 'package.json'), JSON.stringify({ name, version }, null, 2) + '\n');
    await writeFile(join(root, prefix, 'package-lock.json'), JSON.stringify({ name, version, packages: { '': { name, version } } }, null, 2) + '\n');
  }
  return root;
}

for (const [bump, expected] of [['patch', '0.4.1'], ['minor', '0.5.0'], ['major', '1.0.0']]) {
  test(`release ${bump} updates both packages and lockfiles`, async (t) => {
    const root = await makeReleaseFiles(t);
    assert.equal(await bumpReleaseVersion(root, bump), expected);
    for (const prefix of ['', 'web/']) {
      const manifest = JSON.parse(await readFile(join(root, prefix, 'package.json'), 'utf8'));
      const lock = JSON.parse(await readFile(join(root, prefix, 'package-lock.json'), 'utf8'));
      assert.equal(manifest.version, expected);
      assert.equal(lock.version, expected);
      assert.equal(lock.packages[''].version, expected);
    }
  });
}

test('release refuses mismatched versions without changing any file', async (t) => {
  const root = await makeReleaseFiles(t);
  const webPath = join(root, 'web', 'package.json');
  await writeFile(webPath, JSON.stringify({ name: 'toksight-web', version: '0.3.0' }, null, 2) + '\n');
  const rootBefore = await readFile(join(root, 'package.json'), 'utf8');
  await assert.rejects(bumpReleaseVersion(root, 'patch'), /web\/package\.json version does not match/);
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), rootBefore);
});
