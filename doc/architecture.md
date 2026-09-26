# Architecture and development

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
src/dbtransfer.js   standalone SQLite backups, strict validation before merging (256 MB max)
src/dbcommand.js    CLI import-db/export-db file orchestration
src/usageimports.js durable usage identities and occurrence-aware merge; read-only CLI imports
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
src/payload.js      buildPayload — the --json contract (see doc/data-contracts.md)
src/dates.js        the server-side home for local-time date math (startOfDay/endOfDay/stepDay/
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
src/webserver.js    zero-dep node:http — static web/out + GET/HEAD /api/data and /api/export/db,
                    POST /api/refresh, /api/prices/update, /api/import/cursor and /api/import/db;
                    write routes are same-origin guarded
 any other /api/* path is a JSON 404. Serving rules → doc/web-report.md
src/format.js       ANSI tables & number formatting
src/fsutils.js      walkFiles/walkFilesMany/readJsonl/readJson/pathExists (warning
 semantics: root ENOENT silent, other read failures warn)
web/                Next.js (App Router, JS, no Tailwind), statically exported to web/out
 and served by the CLI. Single page `/`: toolbar → report (hero + KPIs,
 SortableCards of HeatmapCard/AgentsCard, footer) + ExpandedHeatmap
 (the heatmap card opened over the page as a modal sheet: calendar +
 DayDetail for one day, outside `.report`).
 lib/period.js (local YYYY-MM-DD day/month/year math, Monday-start weeks)
 and lib/report.js (pure aggregations) are node:test-covered, as is lib/deck.js
 (the day deck's page packing); lib/prefs.js owns every
 localStorage key; lib/exportImage.js (modern-screenshot) renders
 `.report` minus `.no-export`; lib/i18n.js (zh-CN / en). Visual rules
 locked in design-spec.md
```

Each client parser exports `id`, `label`, `sourceRoots({ env, home })`, and
`collect({ env, home, roots })` returning `{ entries, warnings }`. New clients must be added to
the `clients` map and `clientAliases` in `src/clients/index.js`, get a fixture under
`test/fixtures/<client>/`, a test in `test/clients.test.js`, and README table updates.

## Documentation and dependency boundaries

`README.md` and `README.zh-CN.md` are bilingual user-facing mirrors. Update both when changing
CLI options, data sources, pricing behavior, the dashboard, or JSON output. Keep their scope
and paragraph counts roughly aligned. [design-spec.md](../design-spec.md) is the visual and
interaction authority; [web/README.md](../web/README.md) covers frontend development.
`web/AGENTS.md` is generated by Next.js tooling and remains tooling-owned.

The root CLI has zero runtime dependencies and uses `node:` built-ins. The root lockfile
records only the root package. Build-time Next/React dependencies live in `web/package.json`;
Node >=22.5 is required for built-in SQLite. Windows paths and fixtures are supported;
`pathExists` treats `ENOTDIR` for files as absence.
