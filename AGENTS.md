# AGENTS.md

## What this is

`toksight` — a Node.js CLI (zero runtime dependencies, ESM only, Node >= 20) that tracks token
usage, cost, and cache hit rate of AI coding agents by reading the local session files those
agents already write, plus the `toksight web` local dashboard: a read-only view of the agents'
configuration files with an opt-in bundle export/import (the only write path — backup-first,
allowlist-scoped; there is no TUI). Local-first: stats scan session files read-only, the config
page shows redacted previews, and credential files are never displayed, bundled or imported.
The sole network call is the LiteLLM pricing fetch (skippable with `--offline`).

## Commands

- `node --test` (or `npm test`) — node:test suite, per-client fixtures, no network. Do not pass
  `test/` as a directory arg (MODULE_NOT_FOUND on Node v24/Windows); the npm script omits the
  path, explicit files or a `test/*.test.js` glob also work.
- `node bin/toksight.js` (or `npm run smoke`) — run the CLI from source against real agent data.
- `npm run web:ci` — install locked dashboard dependencies (needs network the first time).
- `npm run web:build` — build + verify the static export into `web/out/` (never installs).
  Source web builds/dev need Node >=20.9. Required once before `toksight web` shows the UI;
  until then `/` serves a setup page while `/api/data` works.
- `npm run web:dev` — loopback API (4729) + Next dev server (3000) together; accepts
  `-- --port <ui> --api-port <api> --offline`; Ctrl+C stops both. `web:dev:ui` runs only Next —
  pair it with `web --api-only` and point its proxy at `TOKSIGHT_DEV_API`. Production builds
  always export regardless of that env var.
- `npm run check:package` — pack, install the tarball offline in a temp dir, then exercise its
  CLI: both pages, static resources, APIs and a fixture-only import/restore round trip. CI and
  release gates run it on Ubuntu/Windows (Node 22).
- No linter or typechecker; plain JavaScript ESM throughout.

## Architecture

```
bin/toksight.js     executable entry → src/cli.js main()
src/cli.js          dispatch only: parse → help/version → web (runWeb) → collect → render;
                    no collection or rendering logic lives here
scripts/            source-only dev supervisor (web-dev reuses cli.runWeb and owns its
                    lifetime), build helpers, installed-package verification; npm-excluded
src/args.js         parseArgs — `--flag value` AND `--flag=value`; `now` injectable for tests
src/collect.js      collectAll — the one pipeline for CLI/--json/web (env/home injection);
                    perClient rows carry { id, label, roots, entries }; filterEntries shared
                    with web; reportedCosts WeakSet keeps agent-reported cost provenance
                    without adding fields to normalized entries
src/webservice.js   createWebDataService — concurrent requests share only the unfiltered
                    collection promise; no settled snapshot cache
src/webquery.js     query-param validation; intersects startup scope (never widens);
                    invalid/duplicate params → HTTP 400
src/comparison.js   adjacent equal-calendar-day comparison, contributions, coverage,
                    explicit no-baseline/incomplete states
src/costcoverage.js cost-source counts/amounts (reported/user/LiteLLM/builtin), unpriced,
                    used cache-fallback counts; one price snapshot for both periods
src/render.js       all text rendering + renderJson + warnings + empty-state page
src/payload.js      buildPayload — the --json contract (see Gotchas)
src/dates.js        the ONLY home for local-time date math (startOfDay/endOfDay/stepDay/
                    startOfMonth/eachDay/dayKeyToTs/parseDateArg/calendarDaysBetween);
                    invalid calendar dates rejected, never normalized; DST-safe local
                    midnights, never blind `+24h`; do not re-implement day math elsewhere
src/clients/        one parser per agent; index.js holds clients + clientAliases;
                    sqlite.js centralizes the dynamic node:sqlite readOnly open
src/pricing.js      builtin → LiteLLM (1h disk cache) → user overrides; { exact, suffix }
                    lookup maps (suffix pre-index is O(1))
src/aggregate.js    grouping/totals (summarize, byModel/Day/Month/Session, cacheHitRate)
src/webdata.js      pure dashboard aggregations (heatmap, trend, hourly, sessions…); day
                    math imported only from src/dates.js
src/toml.js         tolerant TOML subset parser ({ value, error }, never throws)
src/agentconfigs.js compatibility re-exports of the config service (inventory, fileDefs, redact)
src/agenttransfer.js compatibility re-exports of the transfer service + bundle constants
src/config/         one module per concern: files (allowlist + target paths) · limits ·
                    parse/redact · summaries · inventory (read-only, redacted previews) ·
                    compare (redacted bounded diff, revisions, target inspection) ·
                    transfer (export/plan/apply — the ONLY config write path) · backups
                    (exclusive copying, metadata-only listing). Invariants → Gotchas
src/webserver.js    zero-dep node:http — static web/out, /api/data, loopback-only
                    /api/config (GET inventory/backups/export; POST import preview/apply
                    are the only write routes). Serving/security rules → Gotchas
src/format.js       ANSI tables & number formatting
src/fsutils.js      walkFiles/walkFilesMany/readJsonl/readJson/pathExists (warning
                    semantics: root ENOENT silent, other read failures warn)
web/                Next.js (App Router, JS, no Tailwind), statically exported to web/out
                    and served by the CLI. `/` dashboard, `/config` viewer + export/import/
                    restore; components/Shell.jsx is the shared page shell (it also owns the
                    theme switch); lib/clients.js holds the single source of client display
                    names, lib/useLocale.js the locale hook, lib/theme.js the theme hook
                    (system/light/dark → `data-theme` on <html>, pre-paint snippet in
                    app/layout.js, localStorage `toksight-theme`), lib/api.js the fetchJson
                    helper; lib/i18n.js dictionaries (zh-CN / en, localStorage
                    `toksight-locale`) are parity-tested, and lib/palette.js ↔ globals.css
                    `--color-cat-*` (light :root ramp + dark override block) is pinned by
                    test/palette.test.js — inline styles must use colorAt()'s var()
                    references, never hex. app/page.js lays the dashboard out as a single
                    content-sized column — a text tab bar splitting the
                    merged cards into history (trend, Token-activity heatmap headed by the
                    four-stat KPI row (components/Kpis.jsx StatRow), hour|month|pace trio),
                    cost
                    (comparison + cost details, agents|models split) and sessions, deep-
                    linked via ?tab= — no filter bar, no drag grid; visual rules locked in
                    design-spec.md (v8 minimal editorial paper, light + dark) — do not
                    ship raw ui-ux-pro-max --persist output
```

Each client parser exports `id`, `label`, `sourceRoots({ env, home })`, and
`collect({ env, home, roots })` returning `{ entries, warnings }`. New clients must be added to
the `clients` map and `clientAliases` in `src/clients/index.js`, get a fixture under
`test/fixtures/<client>/`, a test in `test/clients.test.js`, and README table updates.

### Normalized entry shape (the core contract)

Every parser emits records with exactly: `client, sessionId, model, timestamp` (ms epoch or
`null`), `inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens`,
`costUsd` (see below), `directory, title`. Cost is computed centrally in `src/collect.js`
(`collectAll` → `computeCost`) — parsers leave `costUsd: null` unless the agent itself reports
cost (only OpenCode does).

## Gotchas & rules

- **OpenCode db-first guard**: v1.2+ `~/.local/share/opencode/opencode.db` (`message` table, JSON
  `data` column, LEFT JOIN `session` for directory/title) is the source of truth;
  `<base>/storage/message/*.json` (v1.1.x layout) is a fallback used only when the db is absent
  (silently) or cannot be read (warning). Never collect from both. SQLite-era rows hardcode
  `cost: 0` as a placeholder — only non-zero self-reported costs are honored there (legacy JSON
  costs are honored as-is).
- **ZCode double-count guard**: the SQLite db (`~/.zcode/cli/db/db.sqlite`, `model_usage` table)
  is the source of truth; `~/.zcode/cli/rollout/*.jsonl` is a fallback only when the db is absent
  (silently) or unreadable (warning). Never collect from both. `node:sqlite` needs Node >= 22.5;
  on older Node the db test skips and parsing falls back to rollout. ZCode's `input_tokens`
  counts the whole prompt **with cache reads included**, so both paths subtract `cacheRead` to
  emit fresh input — otherwise the hit-rate denominator and `computeCost` double-count cached tokens.
- **Parsers must never throw** on bad data: tolerate malformed/unreadable files, push messages
  into `warnings`, skip empty-usage rows. `collectAll` gathers clients via `Promise.allSettled`
  and prints warnings on stderr (also under `warnings` in JSON output). Warnings cover read
  failures that are NOT a plain missing root (`walkFiles` ENOENT on a root is silent; EACCES/
  ENOTDIR etc. warn), kimi `state.json` that exists but cannot be read/parsed, and entries
  without a usable timestamp (null or non-finite — parsers normalize NaN to null) excluded by
  `--since`/`--until` (reported, never silently dropped).
- **Claude dedup is max-wins**: assistant lines can repeat a message id with a *growing* usage
  snapshot (streaming partial → final). Keep the snapshot with the largest token total, not the
  first line (first-wins undercounts).
- **Dedup/diff semantics per client** (tests pin these — preserve when editing parsers): Claude
  dedupes message ids (max-wins, above); Codex prefers `last_token_usage` and diffs cumulative
  totals; Kimi counts every `usage.record` as-is (per-request, never cumulative; both `turn` and
  `session` usageScope records are real spend).
- **Env injection**: parsers take `{ env, home }` params instead of reading `process.env`, so
  tests can point them at fixtures (`ZCODE_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
  `OPENCODE_PATH`, `KIMI_CODE_HOME`). `collectAll(opts, { env, home })` threads the injection
  through the whole pipeline (pricing config included), pinned by `test/cli.test.js`.
- **`--json` output is a user-facing contract**: shape is `totals, cacheHitRate, clients, models,
  daily, monthly, sessions, pricing (incl. unpricedModels), warnings` — don't break it
  (`buildPayload` in `src/payload.js`). `GET /api/data` reuses this exact payload and layers the
  `src/webdata.js` extras additively (heatmap, trend, trendByAgent, trendByModel, hourly, today, last7Days,
  thisMonth, topSessions, longestSession — ranked by activeMs with idle gaps capped at 5min —
  activityRange, timezone) plus newer additive extras: `view`, `selection`, `costCoverage`,
  `comparison`; legacy extras must stay present. Each `clients` entry is that agent's totals plus
  its own `cacheHitRate` built from the **filtered** entries, so `--client`/`--since`/`--until`
  apply like every other slice (pinned by `test/payload.test.js`).
- **Local timezone**: day grouping and `--since`/`--until` use the machine's local time, not UTC.
- **Cache hit rate** = `cacheRead / (freshInput + cacheRead)`; cache *writes* are excluded (cold
  traffic being stored, not served). Attributed **per request** — each entry carries its own
  model and token split, so a session that switched models splits cleanly across per-agent /
  per-model views (a model's cache can only hit for that same model).
- **Zero runtime dependencies**: do not add packages to the root CLI; use `node:` builtins
  (`package-lock.json` only records the root package). `web/` is the only place allowed to have
  dependencies (Next/React, build-time only, declared in `web/package.json`).
- **Web serving rules**: `toksight web` re-collects on every request (fresh data — the
  single-flight in `createWebDataService` dedupes only CONCURRENT requests onto one collection
  run, no TTL); binds 127.0.0.1 by default (never 0.0.0.0); static assets under
  `web/out/_next/` are immutable-cached, everything else `no-cache`; path traversal → 403; if
  `web/out/index.html` is missing, `/` serves the built-in setup page instead of failing.
  `/api/data` accepts `period=all/today/7d/30d/month/custom`, `client`, `since`, `until`, each
  response intersected with startup scope (never widened). `selection` carries historical
  trend/heatmap rows capped at the last 366 days (totals/comparison stay complete); without a
  start date comparison uses seven days ending on the selected end date/today, and is
  unavailable if the previous window falls outside startup scope. UI request
  cancellation/sequence checks keep stale responses from replacing newer data; the
  dashboard has no filter UI — the URL query string is read once at mount so manual
  deep links keep working.
- **Config viewer scope/redaction**: the config page inventory is strictly read-only. Only
  user-level files for ZCode, Claude Code, Codex CLI, OpenCode and Kimi Code are allowlisted
  (`src/config/files.js`, re-exported via `src/agentconfigs.js`); project/managed policy files
  are out of scope on purpose. Credential files (ZCode `v2/credentials.json`, Claude
  `.credentials.json`, Codex `auth.json`/`.env`, OpenCode data-dir `auth.json`, Kimi
  `credentials/`) are probed for existence and whitelisted facts ONLY (auth mode, key names,
  env-var names) — never previewed, never bundled, never importable (evalEntry rejects
  kind:'secret'). Everything else gets `redactConfig`: JSON/JSONC parse to a tree (string-aware
  JSONC stripper, then per-key redaction), TOML/text fall back to line redaction — quote- and
  multi-line-aware (a sensitive value spanning `"""`/`'''` or unbalanced brackets suppresses its
  continuation lines). `env` blocks are walked per variable name (SENSITIVE_CONTAINER excludes
  env deliberately) so Claude relay configs stay readable; `oauth`/`headers`/`credentials`
  containers collapse whole. Redact complete content BEFORE truncating — never truncate JSON
  before parsing. Previews cap at 64 KB; files over 1 MB keep metadata only. `GET /api/config`
  requires loopback clients with a localhost Host header and rejects every other method.
- **Import safety** (the single write path `POST /api/config/import[/preview]`, served by
  `src/config/transfer.js`): targets resolve from THIS machine's allowlist only (a bundle's
  recorded paths are informational); per-file content cap 1 MB, whole request body cap 10 MB.
  Every existing target is copied EXCLUSIVELY (symlink-refusing, via `backups.js`) to
  `<config>/toksight/backups/<agentId>/<fileName>.<fileId>.<ts>-<random>` before the
  temp-file+rename swap; new files use mode 0600, replacements preserve permission bits; targets
  are re-inspected before rename. Unchanged configs skip writes and backups; unreadable,
  non-file or oversized targets are blocked. Failed writes clean up temp files and only report
  backups that actually reached disk. Bundled content is UNREDACTED on purpose (migration needs
  real values) — the UI warns. Preview diffs are redacted and bounded (64 KB / 600 lines per
  side). UI applies carry `expected` target/source revisions from preview; stale content fails
  per-file before writing (legacy bundle-only API calls remain accepted).
  `GET /api/config/backups` lists metadata only (latest 200). Import preview/apply also accept
  `{ backupId }` instead of `{ bundle }` (mutually exclusive); the server rebuilds the bundle
  internally and never returns backup plaintext; backup ids resolve only against known agents
  and filename patterns, never arbitrary client paths; legacy backup names work only for
  unambiguous allowlist targets. Restoration flows through applyImport and therefore backs up
  current content again — do not add a separate restore write endpoint.
- **Config API gates**: all /api/config routes validate Host against localhost names
  (DNS-rebinding defense — always, even when `--host` is non-loopback) and reject
  `Sec-Fetch-Site: cross-site`; write POSTs additionally require application/json + a matching
  `x-toksight-action` header (both force a CORS preflight this server never answers, so foreign
  pages cannot fire writes). Those loopback/Host/cross-site gates answer BEFORE reading any
  body; every later rejection (413/405/415/403/503) drains the body first so local clients get
  the JSON error, not a connection reset.
- Windows compatibility matters (paths, fixtures use `C:\\...` directories); `pathExists`
  handles `ENOTDIR` for files.

## Release

Versioning: bump `package.json` (+ keep `web/package.json` in sync), commit. GitHub Releases
are automated by `.github/workflows/release.yml`: push a `v*` tag **matching `package.json`'s
version** (e.g. `git tag v0.4.0 && git push origin v0.4.0`) → test matrix (Ubuntu + Windows,
Node 20/22/24) + installed-package checks (Ubuntu/Windows, Node 22) → tag/version guard →
GitHub Release with auto-generated notes. npm publishing is deliberately NOT automated —
`npm publish` stays a manual step (lifecycle: `prepublishOnly` re-runs tests, `prepack` rebuilds
`web/out` into the tarball at pack time, so `web/out` never needs a manual build).

## Docs

`README.md` and `README.zh-CN.md` are bilingual mirrors — update both when changing CLI options,
data sources, pricing behavior, the web dashboard, or the JSON shape; keep their paragraph
counts roughly equal. `design-spec.md` is the locked visual spec for the dashboard.
`pricing.json` user overrides match model names exactly or by `provider/`-suffix (e.g.
`zhipuai/glm-5.3` covers `GLM-5.3`). `web/AGENTS.md` is generated by Next.js tooling — keep it
when committing.
