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
agent and normalized model name. The model card shows a per-million-token rate when every ID in
that row has the same rate; JSON `pricing.modelRates` retains raw IDs, effort and rates.
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
updates the displayed report and open day card; the footer shows when the database was last
refreshed. `toksight refresh --offline` skips pricing fetches.

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
into the future), switches light / dark / system theme and 中文 / EN, and refreshes. Three small
cards beside the report import Cursor CSV, export an image, and update prices; on narrow screens
they sit above the report. The report starts with the period's tokens, reference cost, cache hit
rate and requests, followed by two chapter cards:

1. **Activity heatmap** — a calendar (month) or 53-week grid (year) of daily tokens or cost
   (toggle on the card), plus active days, average per active day, peak day, longest streak and
   per-day tooltips.
2. **Agents & models** — each agent's share of the period's tokens or cost. In token mode the bar
   splits into input / cache read / cache write / output; cost, cache hit rate, requests and
   sessions sit underneath. That agent's models are listed under the row, always ranked by cost
   (rank, monospace name, share of the period's cost, and published per-token rates when every
   underlying ID agrees). Cursor effort suffixes such as `opus5.5-high` disappear from the label.
   Past eight models for one agent, the tail folds into one "N other model uses" row.

Click any day on the heatmap to open the **day card** beside the report: that day's tokens, cost,
cache hit rate and requests, a 24-hour breakdown, the same model costs nested under each agent, and its
sessions (title, time span, active time, directory, models). On wide screens the report column
glides aside and the card unfolds from its edge, the pair staying centred; on narrow ones it floats
over the page. Step days with ‹ ›, close with × / Esc or by clicking the day again. The card is
never part of the exported image.

Drag a card by its handle (or focus the handle and press ↑ / ↓) to reorder the chapters. The
order, period mode, card metrics, theme and language are remembered in `localStorage`.
**Export image** saves the KPI summary, both cards in their current order and the footer as one
PNG (`toksight-2026-09.png` / `toksight-2026.png`) with the controls stripped — ready to share.
Reference cost is an estimate from public prices, not a subscription bill; unpriced models are
listed in the footer.

Startup filters (`--client`, `--since`, `--until`, `--today/--week/--month`) bound the data the
server can see; the report never widens that scope.

The API accepts e.g. `GET /api/data?period=custom&since=2026-09-01&until=2026-09-30` (what the
report requests; the day panel asks for a single day the same way) or `?client=claude&period=7d`. `period` is `all` (default) / `today` / `7d` /
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
the CLI's HTTP server. Per-module notes live in [AGENTS.md](./AGENTS.md).

```bash
npm run check:package # pack, install the tarball offline in a temp dir, then exercise
                      # the page, JS/CSS/fonts and the data API against fixtures
```

It needs network only to install locked web dependencies, uses throwaway agent fixtures (never
your real sessions), and cleans up afterward. PR and main-branch CI run the test suite and
this check on Ubuntu/Windows.

### Releasing

Releases are automated by [.github/workflows/release.yml](.github/workflows/release.yml):
push a `v*` tag that matches `package.json`'s version and the workflow runs the full test
matrix (Ubuntu + Windows, Node 20/22/24) and Ubuntu/Windows package checks, verifies the tag against the package version,
then opens a GitHub Release with auto-generated notes.

```bash
# First update both package.json versions and their lockfiles, then commit
git tag vX.Y.Z                # X.Y.Z must match package.json
git push origin main vX.Y.Z   # the tag starts the release workflow
```

If the tag doesn't match the package version, or a test or package check fails, no release is created.
Publishing to npm is intentionally manual — run `npm publish` yourself when needed (the
`prepublishOnly` / `prepack` scripts re-run the tests and rebuild `web/out` into the
tarball).

### Roadmap

- [x] Web dashboard (`toksight web`, phase 2)
- [x] Monthly / yearly report with reorderable cards and image export (`toksight web`)
- [ ] TUI watch mode
- [ ] More clients (Windsurf, pi…)
- [ ] `--export csv`, leaderboard-style sharing

## License

MIT. Not affiliated with Zhipu AI, Anthropic, OpenAI or any agent vendor.
