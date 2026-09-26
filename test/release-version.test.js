import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bumpReleaseVersion, compareVersions, readReleaseVersion } from '../scripts/release-version.js';
import { checkReleaseVersion } from '../scripts/check-release-version.js';
import { hasMergedReleasePr, highestStableVersion, matchesPublishedSource, planRelease } from '../scripts/release-plan.js';

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

for (const [bump, expected] of [['patch', '0.4.1'], ['minor', '0.5.0'], ['major', '1.0.0'], ['0.4.7', '0.4.7']]) {
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

test('release version checks all four files and permits an unchanged maintenance PR', async (t) => {
  const root = await makeReleaseFiles(t);
  assert.equal(await readReleaseVersion(root), '0.4.0');
  assert.equal(checkReleaseVersion('0.4.0', '0.4.0'), 'no version change');
  assert.equal(checkReleaseVersion('0.4.2', '0.4.0'), 'release 0.4.2');
  assert.throws(() => checkReleaseVersion('0.3.9', '0.4.0'), /older/);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
});

test('release helper refuses invalid or older explicit versions without changing files', async (t) => {
  const root = await makeReleaseFiles(t);
  const before = await readFile(join(root, 'package.json'), 'utf8');
  await assert.rejects(bumpReleaseVersion(root, '0.3.9'), /must be newer/);
  await assert.rejects(bumpReleaseVersion(root, '0.4.1-beta.1'), /stable X.Y.Z/);
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), before);
});

test('release plan distinguishes new releases, maintenance and safe retries', () => {
  const base = {
    version: '0.4.1', previousVersion: '0.4.0', latestVersion: '0.4.0',
    published: false, tagSha: null, headSha: 'new-commit',
  };
  assert.equal(planRelease(base), 'publish');
  assert.equal(planRelease({ ...base, tagSha: 'new-commit' }), 'publish');
  assert.equal(planRelease({ ...base, published: true, latestVersion: '0.4.1', tagSha: 'new-commit' }), 'recover');
  assert.equal(planRelease({ ...base, version: '0.4.0', previousVersion: '0.4.0', published: true }), 'skip');
  assert.equal(planRelease({ ...base, version: '0.4.0', previousVersion: '0.4.0', published: true, tagSha: 'original-release' }), 'skip');
  assert.throws(() => planRelease({ ...base, tagSha: 'other-commit' }), /another commit/);
  assert.throws(() => planRelease({ ...base, published: true }), /already published/);
  assert.throws(() => planRelease({ ...base, latestVersion: '0.4.2' }), /newer than npm published version/);
  assert.throws(() => planRelease({ ...base, published: true, latestVersion: '0.4.2', tagSha: 'new-commit' }), /Cannot recover/);
  assert.equal(highestStableVersion({ '0.4.0': {}, '0.5.0-beta.1': {}, '0.4.3': {} }), '0.4.3');
  assert.throws(() => planRelease({ ...base, highestVersion: '0.5.0' }), /newer than npm published version/);
});

test('published release recovery requires provenance for the same workflow and commit', () => {
  const statement = {
    predicate: { buildDefinition: {
      externalParameters: { workflow: {
        repository: 'https://github.com/Sanstoolow0513/toksight',
        path: '.github/workflows/release.yml',
      } },
      resolvedDependencies: [{ digest: { gitCommit: 'new-commit' } }],
    } },
  };
  const attestations = [{
    predicateType: 'https://slsa.dev/provenance/v1',
    bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } },
  }];
  assert.equal(matchesPublishedSource(attestations, 'new-commit', 'Sanstoolow0513/toksight'), true);
  assert.equal(matchesPublishedSource(attestations, 'other-commit', 'Sanstoolow0513/toksight'), false);
  assert.equal(matchesPublishedSource(attestations, 'new-commit', 'other/repository'), false);
  assert.equal(matchesPublishedSource([], 'new-commit', 'Sanstoolow0513/toksight'), false);
});

test('only a PR merged into release can initiate publication', () => {
  const pr = { merged_at: '2026-09-26T00:00:00Z', base: { ref: 'release' }, merge_commit_sha: 'new-commit' };
  assert.equal(hasMergedReleasePr([pr], 'new-commit'), true);
  assert.equal(hasMergedReleasePr([{ ...pr, merged_at: null }], 'new-commit'), false);
  assert.equal(hasMergedReleasePr([{ ...pr, base: { ref: 'main' } }], 'new-commit'), false);
  assert.equal(hasMergedReleasePr([pr], 'direct-push'), false);
});
