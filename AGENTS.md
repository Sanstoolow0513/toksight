# AGENTS.md

## What this is

`toksight` — a Node.js CLI (zero runtime dependencies, ESM only, Node >= 22.5) that tracks token
usage, cost, and cache hit rate of AI coding agents by reading the local session files those
agents already write or importing Cursor Usage Events CSV through `toksight web`, plus the local
report: one page per calendar month or year
with two reorderable cards (heatmap · agent table, each agent row expands to its models; tokens and cost always shown together), a double-click-to-open heatmap sheet with day details and PNG
export (there is no TUI).
Local-first: nothing is written to agent files. Refresh writes toksight's own SQLite database.
External calls fetch LiteLLM prices and Cursor's official Markdown price table for the shared
price catalog; `--offline` skips both network requests.

## Commands

- `node --test` (or `npm test`) — node:test suite, per-client fixtures, no network. Do not pass
  `test/` as a directory arg (MODULE_NOT_FOUND on Node v24/Windows); the npm script omits the
  path, explicit files or a `test/*.test.js` glob also work.
- `node bin/toksight.js` (or `npm run smoke`) — run the CLI from source against real agent data.
- `npm run web:ci` — install locked dashboard dependencies (needs network the first time).
- `npm run web:build` — build + verify the static export into `web/out/` (never installs).
  Source web builds/dev need Node >=22.5. Required once before `toksight web` shows the UI;
  until then `/` serves a setup page while `/api/data` works.
- `npm run web:dev` — loopback API (4729) + Next dev server (3000) together; accepts
  `-- --port <ui> --api-port <api> --offline`; Ctrl+C stops both. `web:dev:ui` runs only Next —
  pair it with `web --api-only` and point its proxy at `TOKSIGHT_DEV_API`. Production builds
  always export regardless of that env var.
- `npm run check:package` — pack, install the tarball offline in a temp dir, then exercise its
 CLI against fixtures: the page, static resources, `/api/data` (filters, report periods,
 `scopeRange`) and SQLite refresh. CI and release gates run it on Ubuntu/Windows (Node 22).
- No linter or typechecker; plain JavaScript ESM throughout.

## Architecture

```
bin/toksight.js     executable entry → src/cli.js main()
src/cli.js          dispatch only: parse → help/version → web/refresh → collect → render;
                    no collection or rendering logic lives here
scripts/            source-only dev supervisor (web-dev reuses cli.runWeb and owns its
                    lifetime), build helpers, installed-package verification; npm-excluded
src/args.js         parseArgs — `--flag value` AND `--flag=value`; `now` injectable for tests
src/collect.js      collectAll — the one pipeline for CLI/--json/web (env/home injection);
                    perClient rows carry { id, label, roots, entries }; filterEntries shared
                    with web; reportedCosts WeakSet keeps agent-reported cost provenance
                    without adding fields to normalized entries
src/database.js     project-owned SQLite usage snapshot (transactional refresh, pricing
                    provenance, preload, cross-process change detection); durable Cursor
                    imports survive refresh and are merged into snapshot reads
src/cursorcsv.js    zero-dependency Cursor Usage Events CSV parser (quotes/BOM/CRLF, row keys)
src/cursorpricing.js Cursor official Markdown price table (7-day cache, model ID lookup);
                    `Included` reference estimates use these rates, not LiteLLM prices
src/pricecatalog.js shared model IDs, billing scopes and USD-per-token lookup for every source;
                    Cursor effort is separated from priced variants such as Fast and 500k
src/webservice.js   createWebDataService — GETs filter the committed snapshot; concurrent
                    refreshes share one collection/write promise
src/webquery.js     query-param validation; intersects startup scope (never widens);
                    invalid/duplicate params → HTTP 400
src/comparison.js   adjacent equal-calendar-day comparison, contributions, coverage,
                    explicit no-baseline/incomplete states
src/costcoverage.js cost-source counts/amounts (reported/Cursor/user/LiteLLM/builtin), unpriced,
                    used cache-fallback counts; one price snapshot for both periods
src/render.js       all text rendering + renderJson + warnings + empty-state page
src/payload.js      buildPayload — the --json contract (see Gotchas)
src/dates.js        the ONLY home for local-time date math (startOfDay/endOfDay/stepDay/
                    startOfMonth/eachDay/dayKeyToTs/parseDateArg/calendarDaysBetween);
                    invalid calendar dates rejected, never normalized; DST-safe local
                    midnights, never blind `+24h`; do not re-implement day math elsewhere
src/clients/        one parser per agent; Cursor reads web-imported rows from toksight SQLite;
                    index.js holds clients + clientAliases;
                    sqlite.js centralizes the node:sqlite readOnly open
src/pricing.js      builtin → LiteLLM (7-day disk cache) → user overrides; all feed the
                    shared model price catalog in toksight SQLite
src/aggregate.js    grouping/totals (summarize, byModel/Day/Month/Session, cacheHitRate)
src/webdata.js      pure dashboard aggregations (heatmap, trend, hourly, sessions…); day
 math imported only from src/dates.js
src/webserver.js    zero-dep node:http — static web/out + GET/HEAD /api/data,
                    POST /api/refresh, POST /api/prices/update and POST /api/import/cursor
                    (same-origin guarded);
 any other /api/* path is a JSON 404. Serving rules → Gotchas
src/format.js       ANSI tables & number formatting
src/fsutils.js      walkFiles/walkFilesMany/readJsonl/readJson/pathExists (warning
 semantics: root ENOENT silent, other read failures warn)
web/                Next.js (App Router, JS, no Tailwind), statically exported to web/out
 and served by the CLI. Single page `/`: toolbar → report (hero + KPIs,
 SortableCards of HeatmapCard/AgentsCard, footer) + ExpandedHeatmap
 (the heatmap card opened over the page as a modal sheet: calendar +
 DayDetail for one day, outside `.report`).
 lib/period.js (local YYYY-MM-DD day/month/year math, Monday-start weeks)
 and lib/report.js (pure aggregations) are node:test-covered; lib/prefs.js owns every
 localStorage key; lib/exportImage.js (modern-screenshot) renders
 `.report` minus `.no-export`; lib/i18n.js (zh-CN / en). Visual rules
 locked in design-spec.md
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
cost (OpenCode), or Cursor's imported CSV reports a numeric charge / `Free`. Cursor `Included`
is stored as null but report reads estimate its reference cost from Cursor's published
model rates; numeric CSV charges always win. The estimate is not a billed amount and
`costCoverage.sources.cursor` tracks it. Cursor CSV has no session ID: use null, and aggregations
omit its session counts/details.

## Gotchas & rules

- **OpenCode db-first guard**: v1.2+ `~/.local/share/opencode/opencode.db` (`message` table, JSON
  `data` column, LEFT JOIN `session` for directory/title) is the source of truth;
  `<base>/storage/message/*.json` (v1.1.x layout) is a fallback used only when the db is absent
  (silently) or cannot be read (warning). Never collect from both. SQLite-era rows hardcode
  `cost: 0` as a placeholder — only non-zero self-reported costs are honored there (legacy JSON
  costs are honored as-is).
- **ZCode double-count guard**: the SQLite db (`~/.zcode/cli/db/db.sqlite`, `model_usage` table)
  is the source of truth; `~/.zcode/cli/rollout/*.jsonl` is a fallback only when the db is absent
  (silently) or unreadable (warning). Never collect from both. ZCode's `input_tokens`
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
  daily, monthly, sessions, pricing (incl. unpricedModels, modelRates, updates), warnings` — don't break it
  (`buildPayload` in `src/payload.js`). `toksight refresh --json` returns database status instead.
  `GET /api/data` reuses the report payload and layers the
  `src/webdata.js` extras additively (heatmap, trend, trendByAgent, hourly, today, last7Days,
  thisMonth, topSessions, longestSession — ranked by activeMs with idle gaps capped at 5min —
 activityRange, timezone) plus newer additive extras: `snapshot` (database refresh time/count),
 `view`, `scopeRange` (activity range of
 the startup scope, independent of the requested period — the report's navigation bounds),
 `selection`, `costCoverage`, `comparison`; legacy extras must stay present. Each `clients`
  entry is that agent's totals plus its own `cacheHitRate` built from the **filtered** entries,
  so `--client`/`--since`/`--until` apply like every other slice (pinned by
  `test/payload.test.js`).
- **Local timezone**: day grouping and `--since`/`--until` use the machine's local time, not UTC.
- **Cursor imports**: `POST /api/import/cursor` accepts a raw UTF-8 Usage Events CSV, validates
  its columns, skips zero-usage rows, and stores timestamp + model + four token classes plus
  occurrence identities in `cursor_imports`. Read paths fold legacy all-column fingerprints by
  that identity without deleting stored rows. Reimporting overlapping exports or changed costs
  must not double count; a numeric charge may update a previous `Included` value. The parser maps
  `Input (w/ Cache Write)` to cache writes, `Input (w/o Cache Write)` to fresh input, and
  `Cache Read` to cache reads. Refresh preserves imports; CLI collection reads them from the
  same database. Cross-process snapshot reads include them through SQLite `data_version`.
  Official model rates are cached for 7 days. Web startup and report reads check both public
  price sources when due; the manual price button forces both through `POST /api/prices/update`.
  Normalized USD-per-token rates live in `model_prices`, fetch state in `price_updates`, and
  reports price entries through the shared scoped model-ID resolver without rescanning agents.
  Keep reported charges distinct from official-rate estimates; `Auto` with no routed model stays
  unpriced. Historical rows use cached published rates, so these are reference values.
- **Cache hit rate** = `cacheRead / (freshInput + cacheRead)`; cache *writes* are excluded (cold
  traffic being stored, not served). Attributed **per request** — each entry carries its own
  model and token split, so a session that switched models splits cleanly across per-agent /
  per-model views (a model's cache can only hit for that same model).
- **Zero runtime dependencies**: do not add packages to the root CLI; use `node:` builtins
  (`package-lock.json` only records the root package). `web/` is the only place allowed to have
  dependencies (Next/React, build-time only, declared in `web/package.json`). Node >=22.5 is
  required for the built-in SQLite database.
- **Web serving rules**: `toksight web` preloads the committed SQLite snapshot; first launch
  without a snapshot scans all agents and creates one. GET requests filter it without rescanning.
  `toksight refresh` and `POST /api/refresh` rescan and transactionally replace the snapshot;
  a failed refresh keeps the old data. SQLite `data_version` detects another process's refresh.
  Cursor CSV imports update the committed report without rescanning other agents.
  The server binds 127.0.0.1 by default (never 0.0.0.0); static assets under
  `web/out/_next/` are immutable-cached, everything else `no-cache`; path traversal → 403; if
  `web/out/index.html` is missing, `/` serves the built-in setup page instead of failing.
  `/api/data` accepts `period=all/today/7d/30d/month/custom`, `client`, `since`, `until`, each
  response intersected with startup scope (never widened). `selection` carries historical
  trend/heatmap rows capped at the last 366 days (totals/comparison stay complete); without a
  start date comparison uses seven days ending on the selected end date/today, and is
  unavailable if the previous window falls outside startup scope. A loopback-bound server
  rejects `/api/data`, `/api/refresh`, `/api/prices/update`, and `/api/import/cursor` requests whose Host header is not
  a localhost name (DNS rebinding); write routes also reject cross-origin browser requests;
  `--host 0.0.0.0` opts out on purpose.
- **Web report**: the page requests one calendar period at a time
  (`period=custom&since=<first day>&until=<last day>`, local dates) and derives everything from
  that payload — heatmap from `daily`, agents from `clients`, and each agent's model rows from
  `models` (grouped by agent and display name). There is no tokens/cost metric toggle; the agent
  table's Tokens/Cost header only picks the sort (`toksight-agent-sort`). The table uses
  `table-layout: fixed` so the export clone lays out like the page. `useReport` aborts/sequence-checks so a stale period never replaces a newer one, and
 keeps the previous payload (tagged with its period) on screen while loading. Double-clicking
 the heatmap card opens `ExpandedHeatmap` (a modal sheet outside `.report`; the report card hides
 in place so nothing below moves, and the sheet morphs from/to its rect with a cloned snapshot).
 Its day detail (`useDayReport`, same loader) requests one day as `since=until=<day>` and reads
 that payload's `totals`/`hourly`/`clients`/`models`/`topSessions`; it never feeds the main
 report. Stepping a day out of the period moves the report period with it. The selected-day ring
 is suppressed during export via `.report.is-exporting`. Refresh POSTs the
 database update, then reloads the current report and the loaded day. Day keys are `YYYY-MM-DD`
 strings built from local `Date` parts — never `toISOString()`. Do not add agent-config write routes.
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
counts roughly equal. `design-spec.md` is the locked visual and interaction spec for the web
report (Claude palette, dot grid, card/drag/export behavior).
`pricing.json` user overrides match model names exactly or by `provider/`-suffix (e.g.
`zhipuai/glm-5.3` covers `GLM-5.3`). `web/AGENTS.md` is generated by Next.js tooling — keep it
when committing.
