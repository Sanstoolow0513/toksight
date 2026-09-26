# Release

This is the source workflow for a release PR. The repository workflows are the executable authority; this document explains how to prepare, verify, and recover a release. A local edit or passing local test is not evidence that npm or GitHub Releases has been updated.

## Prepare a PR

Start from the current `release` branch and include the code to publish. Choose an explicit stable `X.Y.Z` version in the PR:

```bash
npm run release:version -- 0.4.1
```

The command also accepts `patch`, `minor`, or `major`. It updates `package.json`, `package-lock.json`, `web/package.json`, and `web/package-lock.json` together. Commit all four. The PR CI runs the Node 22/24 test matrix on Ubuntu and Windows, the installed-package check on both systems, and a release-version check that requires all four versions to agree and prevents a downgrade from the PR base. An unchanged version is allowed for a maintenance PR and does not publish.

Before merging, create a package-scoped npm granular access token for `toksight` with **Read and write (publish and stage)** and **Bypass 2FA** enabled, then add it as the repository Actions secret `NPM_TOKEN`. The workflow passes it to npm as `NODE_AUTH_TOKEN`; do not put the token in a commit or PR. Keep the token's expiry in mind and rotate the secret before it expires. The release job checks that npm accepts the token before creating the tag. Protect the `release` branch with required PR and CI checks so changes cannot bypass pre-merge review.

The token path is temporary: [npm says direct publishing with granular tokens ends in January 2027](https://docs.npmjs.com/about-access-tokens/#direct-publishing-is-being-deprecated). Move to npm trusted publishing before then if automatic, immediate releases should continue.

## After merge

A push to `release` starts `.github/workflows/release.yml`. Runs queue rather than cancel one another. The workflow repeats the cross-platform tests and installed-package check before any tag or registry write. `scripts/release-plan.js` checks the four-file version, the previous branch version, every stable version already on npm, any existing tag, and GitHub's PR association for the triggering commit. A new version must be newer than the previous branch version and every published stable version. A direct push carrying a new version fails the merged-PR check.

The entrypoint is the merged PR's push to `release`; manually pushing a version tag or selecting a manual workflow run does not start this release path.

For a valid new version, the workflow creates `vX.Y.Z` at the exact triggering commit, publishes that commit with `npm publish --access public --provenance`, then creates a GitHub Release with the same tag. `prepublishOnly` reruns tests; `prepack` installs the locked web dependencies and builds `web/out` into the tarball. An unchanged already-published version skips tag, npm, and GitHub Release work.

## Failure and retry

A failed test, package check, or npm token check stops before the tag. If npm publishing fails after the tag was created, rerun the same workflow run; it accepts the tag only when it points to the same commit. If npm succeeded but GitHub Release creation failed, a rerun skips `npm publish` only when npm provenance names the same repository, workflow, and commit. A version published from another commit cannot be overwritten. Recovery also stops if a newer stable npm version has since appeared.

Check the run's jobs, the `vX.Y.Z` tag target, `npm view toksight@X.Y.Z version`, and the GitHub Release before calling a release complete. A local branch state alone does not establish that npm or GitHub Releases is live.
