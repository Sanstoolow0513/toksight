# 🔭 toksight

**Track token usage, cost and cache hit rate of AI coding agents — right from your terminal.**

toksight reads the local session files your AI coding agents already write, plus imported Cursor
usage CSVs, and turns them into
totals, per-model / per-day / per-session breakdowns and cost estimates. It is a Node.js CLI with
zero runtime dependencies, plus a local web report (`toksight web`) with heatmaps, agent and model
breakdowns, and one-click image export.

Inspired by [tokscale](https://github.com/junhoyeo/tokscale) (and in the same spirit as
[ccusage](https://github.com/ccusage/ccusage)); the implementation is original. 中文文档见
[README.zh-CN.md](./README.zh-CN.md)。

## Supported agents

| Client | Data source (default) | Env override |
| --- | --- | --- |
| ZCode | `~/.zcode/cli/db/db.sqlite`; if absent or unreadable, fallback `~/.zcode/cli/rollout/*.jsonl` | `ZCODE_HOME` |
| Claude Code | `~/.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR` |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | `CODEX_HOME` |
| OpenCode | `~/.local/share/opencode/opencode.db`; if absent or unreadable, fallback `~/.local/share/opencode/storage/message/**/*.json` | `OPENCODE_PATH` |
| Kimi Code | `~/.kimi-code/sessions/**/agents/*/wire.jsonl` | `KIMI_CODE_HOME` |
| Cursor | Usage CSV exported from Cursor, imported through `toksight web` | `TOKSIGHT_CONFIG_DIR` (import storage) |

## Install

```bash
npm install -g toksight
# or one-off
npx toksight
```

Requires Node.js >= 22.5. The built-in `node:sqlite` reads ZCode and OpenCode databases and
stores toksight's own local usage database; no runtime package is installed.

## Usage

```bash
toksight              # overview: totals + per-client + top models
toksight daily        # grouped by local day
toksight monthly      # grouped by month
toksight models       # grouped by model
toksight sessions     # top sessions by cost
toksight web          # local usage & cost report (heatmap, agents, models, image export)
toksight refresh      # rescan agents and update the local SQLite database
toksight export-db backup.sqlite  # export the complete committed usage database
toksight import-db backup.sqlite  # merge a backup and deduplicate usage
toksight env          # show detected data sources + pricing state
```

Example (`toksight --since 2026-08-30 --until 2026-08-31`):

```
Tokens 68,590,023  Cost $9.25  1081 requests · 33 sessions
input 3.95M · cache read 63.79M (94.2% hit · write 0) · output 849K
range: 2026-08-30 → 2026-08-31 · clients: all

By client
Client  Req  Sessions  Tokens    Hit   Cost
──────  ───  ────────  ──────  ─────  ─────
zcode   533        18  33.68M  91.9%  $2.37
kimi    486        13  32.91M  96.7%  $4.91
codex    62         2   2.00M  90.8%  $1.96

Top models (up to 20)
Client  Model              Req  Input  Cache R  Cache W  Output    Hit     Cost
──────  ─────────────────  ───  ─────  ───────  ───────  ──────  ─────  ───────
kimi    kimi-code/k3       422   986K   29.01M        0    293K  96.7%    $4.51
codex   GPT-5.6 Sol         62   183K    1.79M        0   25.7K  90.8%    $1.96
zcode   GLM-5.3 Flash      487  2.51M   28.45M        0    442K  91.9%    $1.45
zcode   GLM-5.3             41   116K    1.99M        0   43.3K  94.5%   $0.870
```

### Options

```
--client <a,b>   only include these clients (zcode, claude, codex, opencode, kimi, cursor)
--since <date>   local date (YYYY-MM-DD), inclusive
--until <date>   local date (YYYY-MM-DD), inclusive
--today --week --month   date shortcuts
--top <n>        row limit for models/sessions tables (default 20)
--json           machine-readable JSON on stdout
--port <n>       web dashboard port (default 4729)
--host <addr>    web dashboard bind address (default 127.0.0.1)
--open           open the printed URL in a browser (web only)
--no-open        leave the browser closed (web only; default)
--api-only       web: serve only the JSON API, no static dashboard
--offline        skip LiteLLM and Cursor pricing fetches
--no-color       disable ANSI colors
```

Value options accept both forms: `--since 2026-08-01` and `--since=2026-08-01`.

CLI day grouping and date filters use your **local** timezone. The web report has its own adjustable time zone in Settings.

## Pricing

For agents other than Cursor, token-based costs use three price layers (later wins), unless
the agent reports a usable cost for that request:

1. **Built-in table** — best-effort USD-per-MTok estimates for explicitly listed models,
   available offline. New versions and variants do not inherit a family's older price.
2. **LiteLLM** — fetched from the community
   [model prices](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
   list with a 7-day disk cache at `<toksight-dir>/cache/litellm-pricing.json`. `--offline`
   uses an existing cache without a network request.
3. **User overrides** — edit `<toksight-dir>/pricing.json` (per-MTok USD):

   ```json
   {
     "my-model": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }
   }
   ```

   Model names match exactly or by an unambiguous provider suffix (`zhipuai/glm-5.3` can also cover `GLM-5.3`).

Within each price source, the original catalog ID is matched before normalized aliases.
Dated snapshots retain their exact prices; date-free aliases are accepted only when they
resolve to a catalog name or equivalent rates for the same model and provider. Provider
prefixes are resolved from catalog metadata, and fine-tuned model prefixes remain distinct.

Kimi Code's versioned IDs `kimi-code/k3` and `kimi-code/k3-256k` resolve to the
`moonshot/kimi-k3` reference price, following the official
[model mapping](https://www.kimi.com/code/docs/en/kimi-code/models.html). Original usage IDs
are preserved. Exact endpoint prices take precedence within a source, and user overrides
remain highest priority. This requires a Moonshot catalog rate (an existing cache works
offline) or a user override. The resulting cost is an API reference estimate, not Kimi Code
subscription spending or quota consumption. Rolling IDs such as `kimi-code/kimi-for-coding`
stay unpriced unless explicitly priced: their underlying model can change over time.

LiteLLM's standard long-context fields (`*_above_200k_tokens`, for example) apply per request
using fresh input + cache read + cache write tokens, excluding output. The highest crossed
threshold selects the rates for the whole request; xAI's direct API uses inclusive thresholds.
Missing tier output/cache prices retain published base rates; a missing cache rate at both
levels falls back to the selected input rate. Cache duration and service-tier adjustments
are not inferred. User overrides and reported costs keep their priority.
If a model ID spans different rates, `pricing.modelRates` marks `variableRates` and omits
a single unit price. Context prices survive SQLite backups and offline imports. Existing
Web snapshots gain the context metadata on the next price update or usage refresh.

`<toksight-dir>` is `TOKSIGHT_CONFIG_DIR` when set; otherwise it is
`$XDG_CONFIG_HOME/toksight` when that variable is set, or `~/.config/toksight`.
Models without a price are still counted; their cost shows as `—` and they are listed under
`pricing.unpricedModels` in JSON output. OpenCode's SQLite `cost: 0` is a placeholder, so only
nonzero reported database costs win; numeric costs in legacy JSON are kept as reported.
For Cursor CSV `Included` rows, toksight fetches the official
[Models & Pricing](https://cursor.com/docs/models-and-pricing) Markdown table, discovers model
pages through the official [documentation index](https://cursor.com/docs/llms.txt), and reads
their HTML price tables and model IDs. The downloaded catalog supplies model names, aliases,
Fast variants and explicitly labeled long-context tiers without a model-family allowlist.
toksight estimates a
**reference cost** from that model's input, cache-write, cache-read and output rates. These
estimates appear in cost totals and rankings but are not charges on your Cursor bill. Numeric CSV
costs and `Free` remain authoritative. An `Included` row without a matching Cursor rate (such as
`Auto` without a routed model) stays unpriced. Cursor rates are cached for 7 days at
`<toksight-dir>/cache/cursor-pricing.json`;
`--offline` uses a cached copy, if available. `pricing.sources.cursor` reports the cache state,
and dashboard `costCoverage.sources.cursor` separates these estimates from reported charges.
Explicit `Long Context (>N)` table tiers are selected per request using fresh input + cache
read + cache write tokens. If one raw model ID spans multiple rates, its tooltip omits a single
unit price and JSON marks `variableRates`. Failed detail fetches keep usable overview/cached
rates with warnings. Previously fetched models absent from an update keep their last known
rates and original fetch dates (`retained` / `priceFetchedAt` in `pricing.modelRates`).
The cached published rate is applied to historical rows; past plan rates, unpublished context rules,
regional uplift, plan-specific fees and other billing terms can make the reference estimate
differ from actual usage value.
Older imports did not save the CSV Cost label, so their unknown costs are treated as `Included`
when the database is upgraded.
The web snapshot stores normalized rates from both sources in `model_prices` in toksight's own
`usage.sqlite`, retaining source, billing scope, original catalog names, USD-per-token rates
and context-price metadata. `price_updates` records each source's
last successful fetch and check. Cursor's billing scope uses only Cursor rates. CSV IDs such as
`cursor-grok-4.6-xhigh-fast` resolve to `grok-4.6-fast`, with `xhigh` retained as an effort level;
`opus5.5-high` resolves to the official Claude Opus 5.5 rate. Matching prefers the most specific
catalog name/ID before removing leftover execution-mode words (`low`, `medium`, `high`,
`xhigh`, `thinking`, `max`). Unique brand-free shorthand is accepted; ambiguous or unknown
names stay unpriced and retain their original display names. Thus Max modes group with the
base model, while a published Max model remains distinct automatically. Fast and 500k require
their own catalog prices. New catalog models work after a price update without code edits.
Existing imports benefit without re-uploading the CSV; names in Cursor report rows come from
the matched official catalog, including rows with reported charges.
CSV imports preserve the `Max Mode` column as optional `cursorMaxMode` metadata in stored
records (true/false, or null when unknown); re-importing can fill or correct this metadata
without duplicating events or erasing reported charges. Older records lack the column until
re-imported. A Max mode suffix is kept separately from reasoning effort internally; it does
not imply a known historical plan or automatically add a legacy-plan surcharge.
Other agents use the generic source priority
above. A published price applied to older usage is a current-rate reference estimate, not a
historical bill. Requests are priced using their original model ID, then grouped for display by
agent and normalized model name. A model row's hover tooltip shows the rates used when every
ID in that row has the same rate; JSON `pricing.modelRates` retains raw IDs, effort and rates.
When Cursor lists `-` for a cache rate, those tokens use the listed input rate as a fallback;
`costCoverage.cacheFallbackRequests` counts affected requests.

When a LiteLLM entry has no separate cache prices, toksight estimates cached tokens at that
model's input rate and marks affected requests in `costCoverage.cacheFallbackRequests`. This can
overestimate cache-read costs when their actual rate is lower. Models with separate cache prices use them.

## Web dashboard

`toksight web` starts a small local server (zero-dependency `node:http`) that serves a
statically-exported [Next.js](https://nextjs.org) dashboard plus a JSON API, and prints
the URL (default `http://127.0.0.1:4729`). Pass `--open` to open that URL in a browser. By default
it binds to the loopback interface; `--host` can change the bind address. On first launch it scans
agent files and creates
`<toksight-dir>/usage.sqlite`. Later launches
preload that database; ordinary report and day requests read its committed snapshot without
rescanning agents. The default loopback bind keeps report requests local; `--host` can expose the
API on another interface.

Click **Refresh** above the report, call `POST /api/refresh`, or run `toksight refresh` to rescan
all agents and update the database in one transaction. A failed refresh keeps the previous
snapshot. The web server notices a refresh made by another toksight process. Refreshing also
updates the displayed report and the loaded day details; the footer shows when the database was last
refreshed. `toksight refresh --offline` skips pricing fetches.

**Export database** in **Settings** downloads a standalone `.sqlite` backup of all
committed usage, across every agent and date, regardless of the displayed period or startup
filters. It includes session titles/directories, Cursor imports, prices and cost provenance;
agent files, credentials and browser preferences are not included. Run refresh first if you
want to collect new sessions before exporting. **Import database** accepts a toksight `.sqlite`
or `.db` file (up to 256 MB), shows the merge behavior, then imports transactionally. Invalid or
unsupported databases leave existing data intact. Results show added, updated and duplicate
records; the report moves to the backup's latest usage period.

Imports **merge and deduplicate**; they never replace the destination database. Non-Cursor
records match on agent, session ID, timestamp, model and token counts, preserving the largest
occurrence count of identical requests across backups. Paths and titles do not affect matching.
Existing reported costs and conflicting price records win; a reported cost can fill an estimate.
Cursor retains its CSV event matching. Changed usage fields cannot be recognized as the same
request and may count again. Imported history survives refresh, appears in CLI reports and can
be exported again. Estimates can change when local prices update.

The same operations are available as `toksight export-db <file>` and `toksight import-db <file>`
(`--json` prints transfer statistics). Export requires an existing snapshot (`toksight refresh`
creates one) and refuses to overwrite an existing file. Transfers reject date/client filters.
The web endpoints are `GET /api/export/db` (SQLite download) and `POST /api/import/db` (raw SQLite
bytes, merge statistics as JSON); both retain the local Host check and import requires a permitted
origin. Transfers work offline and never write agent files.

The **Update prices** button above the report calls `POST /api/prices/update` to check LiteLLM and Cursor together,
even within the 7-day interval. Startup and report requests check automatically only when a
source is at least 7 days old; failed checks are retried after an hour. Last successful source
fetch times appear in the report footer and `pricing.updates`. Price updates revalue existing
estimates without rescanning usage or replacing reported charges. `--offline` disables the
manual network update.

To add Cursor history, export **Usage Events** as CSV in Cursor, open `toksight web`, and choose
**Import Cursor CSV** in **Settings**. The file is sent only to the local toksight server and its
usage rows are saved in `usage.sqlite`; repeat or overlapping exports are matched by timestamp,
model and token counts, so changes to billing labels or charges do not add tokens twice. Imports
remain available after refresh and in CLI reports (`--client cursor`). Rows with zero tokens are
skipped. Cursor's CSV has no session ID, so Cursor session counts and session details are omitted.
Its `Cache Read` column allows the same cache hit rate calculation as other agents.
Cursor exports no event ID, so two truly distinct events with identical timestamp, model and
token counts cannot be distinguished from one event repeated across files; if Cursor later revises
a model name or token counts, that event may be counted again. The import reports what it matched.

The dashboard opens on **Today**, with **Calendar** and **Settings** in the sidebar.
The header and navigation use a solid gray background; the report keeps its sparse dot grid and
warm light/dark palette (visual spec: `design-spec.md`). Theme and 中文 / EN stay in the header.
**Refresh**, **Update prices**, and **Export image** are above the report.

- **Today** shows tokens, reference cost, cache hit rate and requests first, followed by hourly
  activity, expandable agents and models, a cross-agent model table and up to ten sessions.
  Pick all agents or a single agent. Session details include title, usage, cost, time span,
  active time, directory and models.
- **Calendar** shows the heatmap and day details directly, side by side on wide screens and
  stacked on narrow screens. Click or keyboard-activate a date to switch details; ‹ / › moves
  one day at a time. There is no overlay, card dragging or paged detail deck. Month/year navigation,
  month jump, **1D / 7D / MTD / 30D**, inclusive custom dates and Agent filters remain available.
  Range totals and token/cost trends sit beside the selected day's stats. Short ranges use a
  calendar; long ranges use week grids grouped by year. Trends use hours for a single day,
  days up to 62 elapsed dates, and months for longer ranges, with missing dates filled as zero.
- **Settings** contains the reporting time zone, database import/export and Cursor CSV import.

The time zone defaults to the browser's detected zone and can be set explicitly, for example
`Asia/Shanghai` when the operating system is set to US time. Today, date boundaries, hourly
buckets and displayed timestamps all use that zone. Clock changes are handled automatically;
the UI uses the same daily view throughout the year. The choice is saved in this browser.
Today and rolling ranges advance at midnight; returning to the browser or refreshing also
updates the date. Changing the reporting zone never changes agent records or the CLI's dates.

Tokens and cost always appear together. Click the Tokens or Cost table header to sort; click
an agent to expand its models. Hover rows for token classes, requests and sessions; model rows
also show matching unit rates. Models beyond the first seven fold into an eighth summary row.
Theme, language, time zone, calendar mode and table sorting are remembered in `localStorage`.
Date and Agent filters stay in page memory; reloading opens Today. Reset in Calendar returns
to the current month and all agents.

**Export image** saves the visible Today report, or the Calendar range and selected day details,
as one PNG with date, Agent, time zone and footer. Controls are excluded; expanded models stay
expanded in the image. Export waits until all displayed data has loaded. Cost totals combine
reported amounts and estimates; they are not a subscription bill. Unpriced models remain listed
in the footer. The frontend remains a static export using the local API.

Startup filters (`--client`, `--since`, `--until`, `--today/--week/--month`) bound the data the
server can see; the report never widens that scope.

The API accepts e.g. `GET /api/data?period=custom&since=2026-09-01&until=2026-09-30` (what the
report requests; day details ask for a single day the same way) or `?client=claude&period=7d`. `period` is `all` (default) / `today` / `7d` /
`30d` / `month` / `custom` (`custom` needs both `since` and `until`); `since`/`until` may also be
used alone; presets cannot combine with explicit dates. Optional `timezone=Asia%2FShanghai` selects
an IANA reporting zone for filters and all calendar/hour aggregates; omission preserves the
server-local default. Unknown, duplicate or invalid parameters
return HTTP 400. `POST /api/refresh` updates the database and returns its refresh time and entry
count and collection warnings. The web API's additive `snapshot` field exposes the refresh time
and count. `POST /api/prices/update` refreshes both public price sources without rescanning
usage. `POST /api/import/cursor` accepts a UTF-8 Cursor usage CSV (up to 20 MB) and returns
imported, updated-charge, duplicate and skipped row counts. Cross-origin write requests are rejected.

### Dashboard bundle

The npm package ships with the prebuilt static files in `web/out/` — installed users just run
`toksight web`, no build and no Next runtime. To preview the production dashboard from a source
checkout (requires Node >=22.5):

```bash
npm run web:ci && npm run web:build && node bin/toksight.js web
```

Until `web/out/` exists, `toksight web` serves a setup-instructions page at `/` while
`/api/data` keeps working. `web:build` only builds (it never installs); rebuild and refresh
after editing the frontend. `npm pack` and `npm publish` rebuild the dashboard automatically.

### Cache hit rate

`cacheRead / (freshInput + cacheRead)` — the share of prompt tokens served from cache. Cache
*writes* are excluded (they are cold traffic being stored, not served). Stats are attributed per
request, so a session that switched models splits cleanly across the per-agent / per-model views —
a model's cache can only ever hit for that same model, so request-level attribution is exact.
ZCode reports `input_tokens` as the whole prompt with cache reads included, so toksight subtracts
them to expose fresh input and keep this formula meaningful across agents. Cursor's CSV already
separates fresh input, cache reads and cache writes.

## Privacy

toksight is local-first: the CLI and web report only **read** your agents' session files. Refresh
writes toksight's own SQLite database under its config directory; price fetches may update local
cache files. toksight does not upload usage or write back to agent files. Cursor CSV imports are
stored in that database. If you change `--host`, other clients on that network may read the
report/API. The only external requests
fetch public LiteLLM prices and Cursor's official pricing overview, model index and model pages. Run `--offline` to
disable both network requests. Report images are
rendered in your browser and saved only where you download them.

## JSON output

Report commands accept `--json` (e.g. `toksight daily --json`). Shape: `totals`, `cacheHitRate`,
`clients`, `models`, `daily`, `monthly`, `sessions`, `pricing` (incl. `unpricedModels`), `warnings`.
Each `clients` entry is that agent's totals plus its own `cacheHitRate`; the map is built from the
filtered entries, so `--client` / `--since` / `--until` apply to it like every other slice.
Each `models` row is grouped by agent and display name, with `modelIds` listing the original IDs;
`pricing.modelRates` keeps per-ID pricing details. Display grouping never changes request costs.
`toksight refresh --json` instead returns the database path, refresh time, entry count and warnings.

`warnings` surfaces collection problems (a directory that cannot be read, a SQLite database that
exists but cannot be opened) and data caveats — notably, entries without a timestamp that were
excluded by `--since` / `--until` are reported there instead of disappearing silently.

The web dashboard consumes the same payload (plus web-only extras such as `heatmap`, `trend`,
`trend7`, `trend90`, `trendByAgent`, `hourly`, `today`, `last7Days`, `last30Days`, `thisMonth`,
`activeDays`, `streaks`, `peakDay`, `topSessions`, `longestSession`, `activityRange`, `timezone`)
from `GET /api/data` on its own origin. Session rows carry both `durationMs` (raw wall-clock span)
and `activeMs` (inter-request gaps capped at 5 minutes); `longestSession` ranks by `activeMs`, so
a session left open overnight no longer counts its idle hours.

The web API additionally exposes `snapshot` (database refresh time and entry count),
`view` (server date, selectable agents and startup scope),
`scopeRange` (first/last activity within the startup scope, whatever period was requested — the
report's navigation bounds), `selection` (selected trends/heatmap, null without date filters),
`costCoverage` (cost sources, unpriced and fallback-cache request counts), and `comparison`
(current/previous periods, deltas and contributions, or an unavailable reason). Existing CLI
`--json` fields are unchanged.

## Development

```bash
npm test             # node:test suite with per-client fixtures (no network needed)
node bin/toksight.js # run the CLI from source
npm run web:ci       # install locked web dependencies from web/package-lock.json
npm run web:dev      # API (4729) + Next dev server (3000) together, with hot reload
```

Open `http://127.0.0.1:3000`; no `web/out/` build needed. Ctrl+C stops both; an occupied port
errors out and shuts down the services the command started.
`npm run web:dev -- --port 3001 --api-port 4730 --offline` overrides the two ports and skips the
pricing fetch. For two-terminal work run `node bin/toksight.js web --api-only` plus
`npm run web:dev:ui` (proxy overridable via `TOKSIGHT_DEV_API`, dev-server only — production
builds always export static files). `web:install` remains for updating web dependencies.

The CLI keeps **zero runtime dependencies**; dashboard dependencies live only in
`web/package.json`, needed just to (re)build `web/out/`. The flows: session files →
parsers → `collectAll` → CLI output or SQLite refresh → `/api/data`; `web/` source → Next build → `web/out/` →
the CLI's HTTP server. Developer architecture, data contracts and maintenance notes are indexed in
[doc/README.md](./doc/README.md); short agent rules live in [AGENTS.md](./AGENTS.md).

```bash
npm run check:package # pack, install the tarball offline in a temp dir, then exercise
                      # the page, JS/CSS/fonts and the data API against fixtures
```

It needs network only to install locked web dependencies, uses throwaway agent fixtures (never
your real sessions), and cleans up afterward. PR and main-branch CI, plus the Release workflow, run the test suite and
this check on Ubuntu/Windows.

### Releasing

Open a PR targeting `release` with the code to publish and an explicit stable version.
For example, `npm run release:version -- 1.1.0` updates both manifests and lockfiles.
PR CI checks version consistency, tests, and the installed package. Once merged, the
Release workflow repeats those checks, then publishes the matching version to npm and
GitHub Releases. A PR without a version change does not publish.

See the [release guide](doc/release.md) for branch protection, npm Trusted Publishing setup, failure recovery, and verification.

### Roadmap

- [x] Web dashboard (`toksight web`, phase 2)
- [x] Today / Calendar / Settings workspace with adjustable time zone and image export (`toksight web`)
- [ ] TUI watch mode
- [ ] More clients (Windsurf, pi…)
- [ ] `--export csv`, leaderboard-style sharing

## License

MIT. Not affiliated with Zhipu AI, Anthropic, OpenAI or any agent vendor.
