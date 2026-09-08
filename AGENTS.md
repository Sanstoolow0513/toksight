# AGENTS.md

## What this is

`toksight` — a Node.js CLI (zero runtime dependencies, ESM only, Node >= 20) that tracks token
usage, cost, and cache hit rate of AI coding agents by reading the local session files those
agents already write, plus a read-only dashboard view of the agents' configuration files with an
opt-in bundle export/import (the only write path — backup-first, allowlist-scoped).
Local-first: stats scan session files read-only, the config page shows redacted previews, and
credential files are never displayed, bundled or imported. The sole network call is the LiteLLM
pricing fetch (skippable with `--offline`). Phase 1 (stats) is done; phase 2 adds the `toksight
web` local dashboard with the agent configuration viewer/transfer (still no TUI).

## Commands

- `node --test` (or `npm test`) — run the node:test suite; uses per-client fixtures, no
  network needed. Note: `node --test test/` with a directory arg fails with MODULE_NOT_FOUND on
  Node v24/Windows (the directory is treated as a module to load) — that's why the script passes
  no path; explicit file paths or a glob like `node --test "test/*.test.js"` also work.
- `node bin/toksight.js` (or `npm run smoke`) — run the CLI from source against real agent data.
- `npm run web:ci` — install locked dashboard dependencies; needs network the first time.
- `npm run web:build` — build and verify the dashboard's static export into `web/out/`;
  does not install dependencies. Source web development/builds need Node >=20.9. Required once
  before `toksight web` shows the UI; until then `/` serves a setup page while `/api/data` works.
- `npm run web:dev` — starts the loopback API (4729) and Next dev server (3000) together;
  accepts `-- --port <ui> --api-port <api> --offline`. Ctrl+C stops both, frontend exit closes
  the API. `web:dev:ui` runs only Next for manual two-terminal development with `web --api-only`;
  `TOKSIGHT_DEV_API` overrides its proxy. Production builds always export regardless of that env var.
- `npm run check:package` — build/pack, install the tarball offline in a temp directory, start
  its CLI with isolated agent fixtures, check both pages, static resources, APIs and a fixture-only import/restore round trip;
  clean up afterward. CI and release gates run this on Ubuntu/Windows (Node 22).
- No linter or typechecker is configured; plain JavaScript ESM throughout (no TypeScript).
- The **root CLI keeps zero runtime deps** (`package-lock.json` only records the root package);
  dashboard dependencies live solely in `web/package.json` and are build-time only.

## Architecture

```
bin/toksight.js     executable entry, calls src/cli.js main()
src/cli.js          command dispatch only: parse → help/version → web (runWeb starts services)
                    → collect → render; no collection or rendering lives here
scripts/            source-only development supervisor, build and installed-package verification;
                    not included in the npm tarball. web-dev reuses cli.runWeb and owns its lifetime
src/args.js         parseArgs (value options accept `--flag value` AND `--flag=value`;
                    `now` injectable for deterministic window tests)
src/collect.js      collectAll — the collection pipeline shared by the CLI, --json and the
                    web API (pricing + clients + filters, env/home threaded for tests);
                    perClient rows carry { id, label, roots, entries } so renderers never
                    re-ask the client registry or use process defaults; filterEntries is shared
                    with web requests. reportedCosts is an internal WeakSet preserving original
                    agent-reported cost provenance without adding fields to normalized entries
src/webservice.js   createWebDataService: concurrent requests share only the unfiltered collection
                    promise, then independently filter/build payloads; no settled snapshot cache
src/webquery.js     validates period/client/since/until query parameters, intersects CLI startup
                    scope (never widens it); invalid/duplicate parameters return HTTP 400
src/comparison.js   adjacent equal-calendar-day comparison, client/model contributions and
                    coverage; no percentage on zero baseline, explicit incomplete/no-record states
src/costcoverage.js actual cost-source counts/amounts (reported/user/LiteLLM/builtin), unpriced and
                    used cache-fallback counts. Shared price snapshot for both comparison periods
src/render.js       all text rendering: renderCommand (per-command pages incl. env),
                    renderJson, tables, totals section, warnings, empty-state page
                    (prints the perClient roots actually scanned)
src/payload.js      buildPayload — the user-facing --json contract (feeds both --json and the
                    web API); presentation-free data layer
src/dates.js        the ONLY home for local-time date arithmetic (startOfDay/endOfDay/stepDay/
                    startOfMonth/eachDay/dayKeyToTs/parseDateArg/calendarDaysBetween). Invalid
                    calendar dates are rejected, not normalized into another month. endOfDay/--week/every day
                    loop step local midnights — DST-safe, never blind `+24h`; do not
                    re-implement these elsewhere
src/clients/        one parser per agent, registered in src/clients/index.js; shared
                    src/clients/sqlite.js openSqliteReadOnly() centralizes the
                    dynamic node:sqlite import + readOnly open for the db-first guards
src/pricing.js      3-layer pricing: builtin table → LiteLLM (1h disk cache) → user overrides;
                    lookup maps are { exact, suffix } — suffix pre-indexes provider-prefixed
                    keys by bare name (O(1), not a per-miss scan of the LiteLLM table)
src/aggregate.js    grouping/totals (summarize, byModel/Day/Month/Session, cacheHitRate)
src/webdata.js      web-dashboard aggregations over entries (heatmap, trend, trendByAgent,
                    hourly, today/last7Days/thisMonth, sessions w/ activeMs, longestSession)
                    — pure functions; day math imported from src/dates.js
src/toml.js        tolerant TOML subset parser for agent configs ({ value, error }, never throws)
src/agentconfigs.js compatibility exports for the read-only config service, fileDefs and redaction
src/agenttransfer.js compatibility exports for the config transfer service and bundle constants
src/config/         files.js: shared user-file allowlist and local target paths; limits.js: caps;
                    parse.js/redact.js: parsing helpers and redaction; summaries.js: per-agent
                    semantic summaries; inventory.js: read-only metadata and redacted previews
                    (redact complete content BEFORE truncating, never truncate JSON before parsing).
                    compare.js: bounded redacted line diff (64 KB/600 lines per side), exact-content
                    revisions, shared target inspection and advisory migration notes. Unchanged
                    configs skip writes/backups; unreadable/non-file/oversized targets are blocked.
                    transfer.js: export, plan and apply; the ONLY config write path, reused by
                    backup restoration. prepareEntries validates/dedupes/allowlists. UI applies
                    carry expected target/source revisions; stale contents fail per-file before
                    writing. Targets are rechecked before rename; legacy bundle-only API calls
                    remain accepted. New files use mode 0600; replacements preserve permission bits.
                    backups.js: exclusive backup copying and metadata-only listing (latest 200).
                    New names include file id + timestamp + randomness to distinguish same-named
                    ZCode files. Legacy names work only for unambiguous allowlist targets. Backup
                    root/agent dirs and files refuse symlinks. Backup ids resolve against known
                    agents and filename patterns, never arbitrary client paths. Failed writes
                    clean temp files and only report backups that reached disk.
src/webserver.js    zero-dep node:http server: static web/out + live /api/data and loopback-only
                    /api/config endpoints (inventory/backups GET, export GET, import preview/apply POST
                    — the only write routes). All /api/config routes validate the Host header
                    against localhost names (DNS-rebinding defense — always, even when
                    --host is non-loopback) and reject Sec-Fetch-Site: cross-site; import POSTs
                    additionally require application/json + a matching x-toksight-action
                    header (both force a CORS preflight this server never answers, so foreign
                    pages cannot fire writes), with a 10 MB body cap. Past those gates, every
                    early rejection drains the request body before answering (drain-then-413
                    extended to 405/415/403/503) so local clients see the JSON error, not a
                    connection reset; the loopback/Host/cross-site gates themselves fire
                    before any drain on purpose — a foreign client's body is never read
src/format.js       ANSI tables & number formatting
src/fsutils.js      walkFiles (returns { files, warnings }: root ENOENT is silent, other read
                    failures warn) + walkFilesMany (multi-root merge shared by the
                    claude/codex/kimi parsers), streaming readJsonl, readJson, pathExists
web/                Next.js (App Router, JS, no Tailwind) dashboard + app/config/page.js,
                    statically exported to web/out and served by the CLI; app/page.js +
                    components/ (Heatmap, TrendChart with mix/agent step-after stacks,
                    AgentsPanel, ModelBars with hard-split cache bars, Bars, TransferPanel
                    (bundle export/import on /config — download/copy bundle, paste/pick file,
                    server-side redacted diff, unchanged skip, revision-checked apply, per-file results;
                    config/RestorePanel lists and previews backups through the same import flow);
                    every chart tooltip is the shared components/Tip)
                    + lib/format.js + lib/i18n.js (zh-CN / en,
                    localStorage `toksight-locale`) + lib/palette.js; fluid layout + motion
                    rules (design-spec.md v6 is the construction spec;
                    design-system/toksight/MASTER.md is a projection of it — do not ship
                    raw ui-ux-pro-max --persist output), Brutalism phosphor worksheet
                    (bg #060609, panel #0e0e15, 2px mosaic in --color-border-strong,
                    lime #c9f24b, radius 0), Geist fonts + lucide-react icons (build-time
                    deps in web/package.json). v6 styling with dashboard filters, reference-cost
                    details and calendar comparison around the 4-cell KPI strip and
                    12-col .sheet (trend, heatmap, agent/model, hour/month/pace, sessions
                    table). Kept from v4: icons only for actions/states (RefreshCw,
                    ChevronDown, FileUp, Download, success/warn/empty/error), no entrance choreography, no ambient
                    glow, no "live" badge (nav shows last-fetch time from generatedAt),
                    categorical palette is brand-lime + slate-gray rank ramp (colorAt
                    encodes rank, not identity).
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
  (silently — the agent never wrote one) or cannot be read (warning). Never collect from both.
  SQLite-era rows hardcode `cost: 0` as a placeholder — only
  non-zero self-reported costs are honored there (legacy JSON costs are honored as-is).
- **ZCode double-count guard**: the SQLite db (`~/.zcode/cli/db/db.sqlite`, `model_usage` table)
  is the source of truth; `~/.zcode/cli/rollout/*.jsonl` is a fallback used only when the db is
  absent (silently) or cannot be read (warning). Never collect from both. `node:sqlite` needs
  Node >= 22.5; on older Node the
  db test skips and parsing falls back to rollout. ZCode's `input_tokens` counts the whole prompt
  **with cache reads included** (rollout `totalTokens = input + output + cacheWrite` proves
  writes stay separate), so both paths subtract `cacheRead` to emit fresh input — without this,
  the hit-rate denominator and `computeCost` double-count cached tokens.
- **Parsers must never throw** on bad data: tolerate malformed/unreadable files, push messages
  into `warnings`, skip empty-usage rows. `src/collect.js` collects clients via
  `Promise.allSettled` and
  prints warnings on stderr (they also appear under `warnings` in JSON output). Warnings also
  cover read failures that are NOT a plain missing root (`walkFiles` ENOENT on a root is silent —
  not every agent is installed; EACCES/ENOTDIR etc. warn), kimi `state.json` that exists but
  cannot be read/parsed, and entries without a timestamp (null OR non-finite — parsers
  normalize NaN to null) excluded by `--since`/`--until`
  (reported instead of silently vanishing).
- **Claude dedup is max-wins**: assistant lines can repeat a message id with a *growing* usage
  snapshot (streaming partial → final). Keep the snapshot with the largest token total, not the
  first line (first-wins undercounts).
- **Dedup/diff semantics per client**: Claude dedupes message ids (max-wins, see above); Codex
  prefers `last_token_usage`
  and diffs cumulative totals;
  Kimi counts every `usage.record` as-is (per-request, never cumulative; both `turn` and
  `session` usageScope records are real spend).
  Preserve these when editing parsers — tests pin them.
- **Env injection**: parsers take `{ env, home }` params instead of reading `process.env`
  directly, so tests can point them at fixtures (e.g. `ZCODE_HOME`, `CLAUDE_CONFIG_DIR`,
  `CODEX_HOME`, `OPENCODE_PATH`, `KIMI_CODE_HOME`). `collectAll(opts, { env, home })` threads
  the same injection through the whole pipeline (pricing config included), pinned by
  `test/cli.test.js`.
- **`--json` output is a user-facing contract**: shape is `totals, cacheHitRate, clients, models,
  daily, monthly, sessions, pricing (incl. unpricedModels), warnings` — don't break it.
  `buildPayload` lives in `src/payload.js`. The web
  API (`GET /api/data`) reuses this exact payload (via `buildPayload`) and layers the
  `src/webdata.js` extras on top (`heatmap, trend, trendByAgent, hourly, today, last7Days,
  thisMonth, topSessions, longestSession (ranked by activeMs — idle gaps capped at 5min),
  activityRange, timezone`); the extras are additive and must stay
  backwards compatible too. Each `clients` entry is that agent's totals plus its own
  `cacheHitRate`, built via `agg.byClient` from the **filtered** entries, so `--client` /
  `--since` / `--until` apply to it like every other slice (pinned by `test/payload.test.js`).
- **Local timezone**: day grouping and `--since`/`--until` use the machine's local time, not UTC.
- **Cache hit rate** = `cacheRead / (freshInput + cacheRead)`; cache *writes* are excluded
  (they're cold traffic being stored, not served). Attributed **per request** — each entry carries
  its own model and token split, so a session that switched models splits cleanly across the
  per-agent / per-model views (a model's cache can only hit for that same model).
- **Zero runtime dependencies**: do not add packages to the root CLI; use `node:` builtins.
  `web/` is the only place allowed to have dependencies (Next/React, build-time only).
- **Web serving rules**: `toksight web` re-collects on every request (fresh data, no caching —
  the single-flight in `createWebDataService` only dedupes CONCURRENT requests onto one collection run, no
  TTL); binds 127.0.0.1 by default (never 0.0.0.0 by default); static assets under `web/out/_next/`
  are immutable-cached, everything else `no-cache`; path traversal is rejected (403); if
  `web/out/index.html` is missing, `/` serves the built-in setup page instead of failing.
  `/api/data` accepts period=all/today/7d/30d/month/custom, client, since and until. Each response
  applies the intersection with startup scope. All new web extras are additive: view, selection,
  costCoverage and comparison. selection contains historical trend/heatmap rows (last 366 days
  at most; totals/comparison remain complete), while legacy extras remain present. Without a
  start date comparison uses seven days ending on the selected end date/today; if the previous
  window is outside startup scope, comparison is unavailable. UI request cancellation/sequence
  checks prevent stale results from replacing a newer filter; URL query preserves filter state.
- **Config viewer scope/redaction**: the config page inventory is strictly read-only. Only
  user-level files for ZCode, Claude Code, Codex CLI, OpenCode and Kimi Code are allowlisted in
  `src/agentconfigs.js`; project/managed policy files are out of scope on purpose. Credential
  files (ZCode `v2/credentials.json`, Claude `.credentials.json`, Codex `auth.json`/`.env`,
  OpenCode data-dir `auth.json`, Kimi `credentials/`) are probed for existence and whitelisted
  facts ONLY (auth mode, key names, env-var names) — never previewed, never bundled, never
  importable (evalEntry rejects kind:'secret'). Everything else gets
  `redactConfig`: JSON/JSONC parse to a tree (string-aware JSONC stripper, then per-key
  redaction), TOML/text fall back to line redaction — quote-aware and multi-line-aware
  (a sensitive value spanning `"""`/`'''` strings or unbalanced brackets suppresses its
  continuation lines to the end of the preview). `env` blocks are walked into per variable
  name (SENSITIVE_CONTAINER excludes env deliberately) so Claude relay configs stay readable;
  `oauth`/`headers`/`credentials` containers collapse whole. Previews cap at 64 KB, files over
  1 MB keep metadata only. `GET /api/config` requires loopback clients with a localhost Host
  header and rejects every other method.
- **Import safety**: `POST /api/config/import[/preview]` is the single write path in toksight.
  Targets are resolved from THIS machine's allowlist only (a bundle's recorded paths are
  informational), each file is content-capped at 1 MB, the whole body at 10 MB, and every
  existing target is copied exclusively to `<config>/toksight/backups/<agentId>/<fileName>.<fileId>.<ts>-<random>` before
  the temp-file+rename swap. Bundled config content is UNREDACTED on purpose (migration needs
  real values, provider keys included) — the UI warns about safe handling. Write POSTs are
  gated on application/json + `x-toksight-action` (CORS-preflight enforcement) and all
  /api/config routes reject `Sec-Fetch-Site: cross-site`.
  `GET /api/config/backups` lists metadata only. Import preview/apply also accept `{ backupId }`
  instead of `{ bundle }` (mutually exclusive); the server reconstructs its bundle internally,
  never returns backup plaintext. `expected` optionally maps file ids to `{ target, content }`
  revisions from preview; the UI always sends them. Restoration creates a new backup of current
  content through applyImport. Do not add a separate restore write endpoint.
- Windows compatibility matters (paths, fixtures use `C:\\...` directories); `pathExists`
  handles `ENOTDIR` for files.

## Release

Versioning: bump `package.json` (+ keep `web/package.json` in sync), commit. GitHub Releases
are automated by `.github/workflows/release.yml`: push a `v*` tag **matching `package.json`'s
version** (e.g. `git tag v0.4.0 && git push origin v0.4.0`) → test matrix (Ubuntu + Windows,
Node 20/22/24) + installed-package checks (Ubuntu/Windows, Node 22) → tag/version guard → GitHub Release with auto-generated notes. npm
publishing is deliberately NOT automated — `npm publish` stays a manual step (lifecycle:
`prepublishOnly` re-runs tests, `prepack` rebuilds `web/out` into the tarball at pack time,
so there is no need to build `web/out` by hand).

## Docs

`README.md` and `README.zh-CN.md` are bilingual mirrors — update both when changing CLI options,
data sources, pricing behavior, the web dashboard, or the JSON shape. `design-spec.md` is the
locked visual spec for the dashboard. `pricing.json` user
overrides match model names exactly or by `provider/`-suffix (e.g. `zhipuai/glm-5.3` covers
`GLM-5.3`). `web/AGENTS.md` is generated by Next.js tooling — keep it when committing.


