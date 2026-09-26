import { execFile } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compareVersions, parseStableVersion, readReleaseVersion } from './release-version.js';

const execFileAsync = promisify(execFile);

export function highestStableVersion(versions) {
  return Object.keys(versions).reduce((highest, version) => {
    try {
      parseStableVersion(version);
      return !highest || compareVersions(version, highest) > 0 ? version : highest;
    } catch {
      return highest;
    }
  }, null);
}

export function planRelease({ version, previousVersion, latestVersion, highestVersion = latestVersion, published, tagSha, headSha }) {
  if (compareVersions(version, previousVersion) < 0) {
    throw new Error(`Release version ${version} is older than previous release branch version ${previousVersion}`);
  }
  if (version === previousVersion && published && version === latestVersion && version === highestVersion) return 'skip';
  if (tagSha && tagSha !== headSha) throw new Error(`v${version} already points to another commit`);
  if (published && tagSha === headSha) {
    if (compareVersions(version, highestVersion) < 0) {
      throw new Error(`Cannot recover ${version} after newer npm release ${highestVersion}`);
    }
    return 'recover';
  }
  if (published) throw new Error(`toksight@${version} is already published from another commit`);
  if (version === previousVersion) {
    throw new Error(`Release version ${version} did not change; rerun the original release or choose a new version`);
  }
  if (compareVersions(version, highestVersion) <= 0) {
    throw new Error(`Release version ${version} must be newer than npm published version ${highestVersion}`);
  }
  return 'publish';
}

export function matchesPublishedSource(attestations, headSha, repository) {
  if (!Array.isArray(attestations)) return false;
  return attestations.some((attestation) => {
    const { predicateType, bundle } = attestation ?? {};
    if (predicateType !== 'https://slsa.dev/provenance/v1' || !bundle?.dsseEnvelope?.payload) return false;
    try {
      const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
      const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
      return workflow?.repository === `https://github.com/${repository}`
        && workflow.path === '.github/workflows/release.yml'
        && statement.predicate?.buildDefinition?.resolvedDependencies?.some(
          ({ digest }) => digest?.gitCommit === headSha,
        );
    } catch {
      return false;
    }
  });
}

export function hasMergedReleasePr(pulls, headSha) {
  return Array.isArray(pulls) && pulls.some((pr) =>
    pr?.merged_at && pr?.base?.ref === 'release' && pr?.merge_commit_sha === headSha,
  );
}

async function checkMergedReleasePr(headSha) {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !token) {
    throw new Error('GitHub repository and token are required to verify the merged PR');
  }
  const url = `https://api.github.com/repos/${repository}/commits/${headSha}/pulls?per_page=100`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub PR lookup failed: HTTP ${response.status}`);
    if (hasMergedReleasePr(await response.json(), headSha)) return;
    if (attempt < 2) await delay(2000);
  }
  throw new Error('A new version must come from a merged PR targeting release');
}

async function git(root, ...args) {
  const { stdout } = await execFileAsync('git', args, { cwd: root });
  return stdout.trim();
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const version = await readReleaseVersion(root);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'toksight') throw new Error('Release package must be toksight');
  const headSha = await git(root, 'rev-parse', 'HEAD');
  if (headSha !== process.env.GITHUB_SHA) throw new Error('Checkout does not match the triggering commit');
  const beforeSha = process.env.RELEASE_BEFORE_SHA;
  if (!/^[a-f0-9]{40}$/.test(beforeSha || '') || /^0+$/.test(beforeSha)) {
    throw new Error('RELEASE_BEFORE_SHA must be the previous release branch commit');
  }
  const previousVersion = JSON.parse(await git(root, 'show', `${beforeSha}:package.json`)).version;
  const tag = `v${version}`;
  let tagSha = null;
  try {
    tagSha = await git(root, 'rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`);
  } catch { /* no tag yet */ }

  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(manifest.name)}`, {
    headers: { Accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`npm registry lookup failed: HTTP ${response.status}`);
  const registry = await response.json();
  const latestVersion = registry['dist-tags']?.latest;
  if (typeof latestVersion !== 'string' || !registry.versions || typeof registry.versions !== 'object') {
    throw new Error('npm registry returned incomplete package metadata');
  }
  const highestVersion = highestStableVersion(registry.versions);
  if (!highestVersion) throw new Error('npm registry has no stable published version');
  const mode = planRelease({
    version, previousVersion, latestVersion, highestVersion,
    published: Object.hasOwn(registry.versions, version), tagSha, headSha,
  });
  if (mode !== 'skip') await checkMergedReleasePr(headSha);
  if (mode === 'recover') {
    const attestationUrl = registry.versions[version]?.dist?.attestations?.url;
    if (!attestationUrl || new URL(attestationUrl).origin !== 'https://registry.npmjs.org') {
      throw new Error(`Cannot verify the published source for toksight@${version}`);
    }
    const attestationResponse = await fetch(attestationUrl, { signal: AbortSignal.timeout(15000) });
    if (!attestationResponse.ok) throw new Error(`npm attestation lookup failed: HTTP ${attestationResponse.status}`);
    const { attestations } = await attestationResponse.json();
    if (!matchesPublishedSource(attestations, headSha, process.env.GITHUB_REPOSITORY)) {
      throw new Error(`Published toksight@${version} does not attest to this release commit`);
    }
  }
  const output = `version=${version}\ntag=${tag}\nmode=${mode}\n`;
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
  console.log(`${tag}: ${mode}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
