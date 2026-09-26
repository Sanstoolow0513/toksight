# Release

This is the source workflow for a release PR. The repository workflows are the executable authority; this document explains how to prepare, verify, and recover a release. A local edit or passing local test is not evidence that npm or GitHub Releases has been updated.

## Prepare a PR

Start from the current `release` branch and include the code to publish. Choose an explicit stable `X.Y.Z` version in the PR:

```bash
npm run release:version -- 1.0.1
```

The command also accepts `patch`, `minor`, or `major`. It updates `package.json`, `package-lock.json`, `web/package.json`, and `web/package-lock.json` together. Commit all four. The PR CI runs the Node 22/24 test matrix on Ubuntu and Windows, the installed-package check on both systems, and a release-version check that requires all four versions to agree and prevents a downgrade from the PR base. An unchanged version is allowed for a maintenance PR and does not publish.

Before merging a version bump, configure [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) for the existing `toksight` package on npmjs.com: **Package settings → Trusted Publisher → GitHub Actions**. Enter GitHub owner `Sanstoolow0513`, repository `toksight`, and workflow filename `release.yml` (filename only, not `.github/workflows/release.yml`). Leave the optional environment name empty because the publish job does not use a GitHub environment. Explicitly allow **`npm publish`**; new trust connections default to allowing staged publishing and do not grant direct publishing unless selected. This requires npm package-owner access and is a one-time external setting. Do not add an `NPM_TOKEN` secret for this workflow. Protect the `release` branch with required PR and CI checks so changes cannot bypass pre-merge review.

## After merge

A push to `release` starts `.github/workflows/release.yml`. Runs queue rather than cancel one another. The workflow repeats the cross-platform tests and installed-package check before any tag or registry write. `scripts/release-plan.js` checks the four-file version, the previous branch version, every stable version already on npm, any existing tag, and GitHub's PR association for the triggering commit. A new version must be newer than the previous branch version and every published stable version. A direct push carrying a new version fails the merged-PR check.

The entrypoint is the merged PR's push to `release`; manually pushing a version tag or selecting a manual workflow run does not start this release path.

For a valid new version, the workflow creates `vX.Y.Z` at the exact triggering commit, then uses a GitHub-hosted Ubuntu job with `id-token: write` and npm 11.5.1+ to publish that commit through npm's OIDC trust. The command is `npm publish --access public`; npm automatically attaches provenance for this public repository and package. The workflow then creates a GitHub Release with the same tag. `prepublishOnly` reruns tests; `prepack` installs the locked web dependencies and builds `web/out` into the tarball. An unchanged already-published version skips tag, npm, and GitHub Release work. `npm whoami` cannot preflight OIDC; npm exchanges the ID token only during publish.

## Failure and retry

A failed test or package check stops before the tag. An npm trust mismatch fails after the tag; fix the npm Trusted Publisher settings, then rerun the same workflow run. It accepts the tag only when it points to the same commit. If npm succeeded but GitHub Release creation failed, a rerun skips `npm publish` only when npm provenance names the same repository, workflow, and commit. A version published from another commit cannot be overwritten. Recovery also stops if a newer stable npm version has since appeared.

Check the run's jobs, the `vX.Y.Z` tag target, `npm view toksight@X.Y.Z version`, and the GitHub Release before calling a release complete. A local branch state alone does not establish that npm or GitHub Releases is live.
