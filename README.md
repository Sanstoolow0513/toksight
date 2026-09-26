# 🔭 toksight

**Track token usage, cost and cache hit rate of AI coding agents — right from your terminal.**

toksight reads the local session files your AI coding agents already write, plus imported Cursor
usage CSVs, and turns them into
totals, per-model / per-day / per-session breakdowns and cost estimates. It is a Node.js CLI with
zero runtime dependencies, plus a local web report (`toksight web`) with heatmaps, agent and model
breakdowns, and one-click image export.

Inspired by [tokscale](https://github.com/junhoyeo/tokscale) (and in the same spirit as
[ccusage](https://github.com/ryoppippi/ccusage)); the implementation is original. 中文文档见
[README.zh-CN.md](./README.zh-CN.md)。

## Supported agents

| Client | Data source (default) | Env override |
| --- | --- | --- |
| ZCode | `~/.zcode/cli/db/db.sqlite`, fallback `~/.zcode/cli/rollout/*.jsonl` | `ZCODE_HOME` |
| Claude Code | `~/.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR` |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | `CODEX_HOME` |
| OpenCode | `~/.local/share/opencode/opencode.db`, fallback `~/.local/share/opencode/storage/message/**/*.json` | `OPENCODE_PATH` |
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

Day grouping and date filters use your **local** timezone.

## Pricing

For agents other than Cursor, costs are computed per request from token counts with three
layers (later wins):

1. **Built-in table** — best-effort USD-per-MTok estimates for common model families,
   always available offline.
2. **LiteLLM** — fetched from the community
   [model prices](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
   list with a 7-day disk cache at `<config>/toksight/cache/litellm-pricing.json`. `--offline`
   uses an existing cache without a network request.
3. **User overrides** — edit `<config>/toksight/pricing.json` (per-MTok USD):

   ```json
   {
     "my-model": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }
   }
   ```

   Model names match exactly or by provider suffix (`zhipuai/glm-5.3` also covers `GLM-5.3`).

`<config>` is `%XDG_CONFIG_HOME% || ~/.config` (override with `TOKSIGHT_CONFIG_DIR`).
Models without a price are still counted; their cost shows as `—` and they are listed under
`pricing.unpricedModels` in JSON output. OpenCode costs reported by OpenCode itself are used as-is.
For Cursor CSV `Included` rows, toksight fetches the official
[Models & Pricing](https://cursor.com/docs/models-and-pricing) Markdown table and estimates a
**reference cost** from that model's input, cache-write, cache-read and output rates. These
estimates appear in cost totals and rankings but are not charges on your Cursor bill. Numeric CSV
costs and `Free` remain authoritative. Unknown models (including `Auto` without a routed model)
stay unpriced. Cursor rates are cached for 7 days at `<config>/toksight/cache/cursor-pricing.json`;
`--offline` uses a cached copy, if available. `pricing.sources.cursor` reports the cache state,
and dashboard `costCoverage.sources.cursor` separates these estimates from reported charges.
The cached published rate is applied to historical rows; past plan rates, long-context multipliers,
regional uplift and other billing terms can make the reference estimate differ from actual usage value.
Older imports did not save the CSV Cost label, so their unknown costs are treated as `Included`
when the database is upgraded.
Both sources are normalized into `model_prices` in toksight's own `usage.sqlite`: one row per
source, billing scope and model ID, with USD-per-token rates. `price_updates` records each source's
last successful fetch and check. Cursor's billing scope uses only Cursor rates. CSV IDs such as
`cursor-grok-4.6-xhigh-fast` resolve to `grok-4.6-fast`, with `xhigh` retained as an effort level;
`opus5.5-high` resolves to the official Claude Opus 5.5 rate. Fast, 500k and Max variants keep
distinct IDs. Other agents use the generic source priority
above. A published price applied to older usage is a current-rate reference estimate, not a
historical bill. Requests are priced using their original model ID, then grouped for display by
agent and normalized model name. A model row's hover tooltip shows per-million-token rates when every
ID in that row has the same rate; JSON `pricing.modelRates` retains raw IDs, effort and rates.
When Cursor lists `-` for a cache rate, those tokens use the listed input rate as a fallback;
`costCoverage.cacheFallbackRequests` counts affected requests.

When a LiteLLM entry has no separate cache prices, cached tokens are billed at that model's input
price — a deliberately conservative overestimate (real cache reads are usually ~10% of the input
price) so costs are never silently undercounted. Models with proper cache prices price normally.

## Web dashboard

`toksight web` starts a small local server (zero-dependency `node:http`) that serves a
statically-exported [Next.js](https://nextjs.org) dashboard plus a JSON API, and prints
the URL (default `http://127.0.0.1:4729`). Pass `--open` to open that URL in a browser. It
binds to localhost only. On first launch it scans agent files and creates
`<config>/toksight/usage.sqlite` (`TOKSIGHT_CONFIG_DIR` overrides the directory). Later launches
preload that database; ordinary report and day requests read its committed snapshot without
rescanning agents. Data never leaves your machine.

Click the toolbar's refresh button, call `POST /api/refresh`, or run `toksight refresh` to rescan
all agents and update the database in one transaction. A failed refresh keeps the previous
snapshot. The web server notices a refresh made by another toksight process. Refreshing also
updates the displayed report and the loaded day details; the footer shows when the database was last
refreshed. `toksight refresh --offline` skips pricing fetches.

**Export database** in the left action area downloads a standalone `.sqlite` backup of all
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

The **Update prices** card beside the report calls `POST /api/prices/update` to check LiteLLM and Cursor together,
even within the 7-day interval. Startup and report requests check automatically only when a
source is at least 7 days old; failed checks are retried after an hour. Last successful source
fetch times appear in the report footer and `pricing.updates`. Price updates revalue existing
estimates without rescanning usage or replacing reported charges. `--offline` disables the
manual network update.

To add Cursor history, export **Usage Events** as CSV in Cursor, open `toksight web`, and choose
**Import Cursor CSV** beside the report. The file is sent only to the local toksight server and its
usage rows are saved in `usage.sqlite`; repeat or overlapping exports are matched by timestamp,
model and token counts, so changes to billing labels or charges do not add tokens twice. Imports
remain available after refresh and in CLI reports (`--client cursor`). Rows with zero tokens are
skipped. Cursor's CSV has no session ID, so Cursor session counts and session details are omitted.
Its `Cache Read` column allows the same cache hit rate calculation as other agents.
Cursor exports no event ID, so two truly distinct events with identical timestamp, model and
token counts cannot be distinguished from one event repeated across files; if Cursor later revises
a model name or token counts, that event may be counted again. The import reports what it matched.

The dashboard is a one-page **token usage & cost report** for a calendar month or a whole year,
in Claude's warm light/dark palette on a sparse dot grid (visual spec: `design-spec.md`). The
toolbar picks **Month / Year** and steps through periods (back to your first recorded day, never
into the future), switches light / dark / system theme and 中文 / EN, and refreshes. Small
cards beside the report import Cursor CSV, export an image, update prices, and import/export the complete database; on narrow screens
they sit above the report. The report starts with the period's tokens (total, input and output),
reference cost (with the blended cost per million tokens), cache hit rate and requests, followed by
two chapter cards. Tokens and cost always appear together; there is no toggle:

1. **Activity heatmap** — a calendar (month) or 53-week grid (year) shaded by daily tokens, with
   each calendar day showing its tokens and cost, plus active days, average per active day, peak
   day (tokens and cost), longest streak and per-day tooltips.
2. **Agents & models** — a table: agent (a fixed identity-color dot and model count), tokens and
   cost (each with its share of the period), a token-mix bar (input / cache read / cache write /
   output), a cache-hit ring and requests. Click the Tokens or Cost header to sort. Agents work
   like folders: models start collapsed, and clicking an agent row (or pressing Enter / Space on
   it) expands its models underneath with the same columns and sort. Hover any row for its four
   token classes and sessions; model rows add published per-million-token rates when every
   underlying ID agrees. Cursor effort suffixes such as `opus5.5-high` disappear from the label.
   Past eight models for one agent, the tail folds into one "N other model uses" row.

Double-click the heatmap card (or press its ⤢ button) to **open** it over the page: the card grows
out of its slot under a scrim while the rest of the report stays put. It keeps the calendar, drops
the period stats and shows the picked day in full — tokens, cost, cache hit rate and requests, a
24-hour breakdown, the same expandable agent table, and its sessions (title, tokens and cost, time
span, active time, directory, models). A month sits beside the day, pinned while the details
scroll; a year runs across the top. Click another day to switch, step with ‹ › or ← →
(crossing into another month or year moves the report with it), and fold the card back with Esc,
`-`, the − button or a click on the scrim. A single click on the report card only marks a day;
Enter on a focused day opens it directly. The opened card is never part of the exported image.

Drag a card by its handle (or focus the handle and press ↑ / ↓) to reorder the chapters. The
order, period mode, table sort, theme and language are remembered in `localStorage`.
**Export image** saves the KPI summary, both cards in their current order and the footer as one
PNG (`toksight-2026-09.png` / `toksight-2026.png`) with the controls stripped — ready to share.
Expanded agents keep their model lists in the image; collapsed ones show only the agent row.
Reference cost is an estimate from public prices, not a subscription bill; unpriced models are
listed in the footer.

Startup filters (`--client`, `--since`, `--until`, `--today/--week/--month`) bound the data the
server can see; the report never widens that scope.

The API accepts e.g. `GET /api/data?period=custom&since=2026-09-01&until=2026-09-30` (what the
report requests; the opened heatmap card asks for a single day the same way) or `?client=claude&period=7d`. `period` is `all` (default) / `today` / `7d` /
`30d` / `month` / `custom` (`custom` needs both `since` and `until`); `since`/`until` may also be
used alone; presets cannot combine with explicit dates. Unknown, duplicate or invalid parameters
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
writes toksight's own SQLite database under its config directory; nothing is uploaded or written
back to agent files. Cursor CSV imports are stored in that database. The only external requests
fetch public LiteLLM prices and Cursor's official Markdown price table. Run `--offline` to
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
the CLI's HTTP server. Per-module notes live in the [engineering docs](doc/README.md).

```bash
npm run check:package # pack, install the tarball offline in a temp dir, then exercise
                      # the page, JS/CSS/fonts and the data API against fixtures
```

It needs network only to install locked web dependencies, uses throwaway agent fixtures (never
your real sessions), and cleans up afterward. PR and main-branch CI, plus the Release workflow, run the test suite and
this check on Ubuntu/Windows.

### Releasing

Open a PR targeting `release` with the code to publish and an explicit stable version.
For example, `npm run release:version -- 0.4.1` updates both manifests and lockfiles.
PR CI checks version consistency, tests, and the installed package. Once merged, the
Release workflow repeats those checks, then publishes the matching version to npm and
GitHub Releases. A PR without a version change does not publish.

See the [release guide](doc/release.md) for branch protection, the npm publish secret, failure recovery, and verification.

### Roadmap

- [x] Web dashboard (`toksight web`, phase 2)
- [x] Monthly / yearly report with reorderable cards and image export (`toksight web`)
- [ ] TUI watch mode
- [ ] More clients (Windsurf, pi…)
- [ ] `--export csv`, leaderboard-style sharing

## License

MIT. Not affiliated with Zhipu AI, Anthropic, OpenAI or any agent vendor.
