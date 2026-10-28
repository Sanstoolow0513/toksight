# 🔭 toksight

**Track token usage, cost and cache hit rate of AI coding agents — right from your terminal.**

toksight reads the local session files your AI coding agents already write and turns them into
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
toksight quota        # subscription quota windows for Codex and Kimi Code
toksight reset-prices # clear saved prices/history/caches, then reopen Web to rebuild
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
--client <a,b>   only include these clients (zcode, claude, codex, opencode, kimi)
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
--offline        skip network pricing fetches; use saved local prices (quota: skip the Kimi request)
--no-color       disable ANSI colors
```

Value options accept both forms: `--since 2026-08-01` and `--since=2026-08-01`.

CLI day grouping and date filters use your **local** timezone. The web report has its own adjustable time zone in Settings.

### Subscription quota

`toksight quota` shows the current rate-limit windows of your Codex and Kimi Code subscriptions:

```
Client     Plan                         Window               Used  Resets
─────────  ───────────────────────────  ──────  ─────────────────  ────────────────────────────
Codex CLI  self_serve_business_prolite  week                   4%  2026-11-02 00:46 (in 6d 17h)
Kimi Code  LEVEL_INTERMEDIATE           5h        69.5% (139/200)  2026-10-26 09:33 (in 2h 33m)
Kimi Code  LEVEL_INTERMEDIATE           week    10.4% (214/2,048)  2026-10-30 07:23 (in 4d)
Kimi Code  LEVEL_INTERMEDIATE           month                0.6%  2026-11-16 16:00 (in 21d 9h)

Codex CLI: from local session logs, last seen 2026-10-26 06:16 (43m ago)
```

- **Codex** is read offline from the newest `rate_limits` in `~/.codex/sessions` (`CODEX_HOME`
  honored). Windows are named by length (`5h`, `week`, otherwise e.g. `2d`); some plans only have
  a weekly window. A window whose reset time has passed shows as reset instead of a stale percentage.
- **Kimi Code** has no local quota data, so `toksight quota` calls `GET https://api.kimi.com/coding/v1/usages`
  with the access token from `~/.kimi-code/credentials/kimi-code.json` (`KIMI_CODE_HOME` honored).
  The token is only sent to Kimi's API host and never printed or stored. toksight never refreshes it;
  if it has expired, open Kimi Code to refresh it and retry.
- `--client codex` / `--client kimi` limits the clients, `--offline` skips the Kimi request, and
  `--json` prints `{ tool, version, generatedAt, quotas }`.

The web report shows the same data in a **Subscription quota** card on Today. Kimi Code is only
queried when you click **Refresh Kimi quota** (`POST /api/quota/refresh`); `GET /api/quota` stays local.

## Pricing

The first Web launch guides you through creating a **local price database** in toksight's
own `usage.sqlite`. LiteLLM is the public price source and is enabled by default. This
computer downloads its [model price table](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
and imports only first-party model providers: OpenAI, Anthropic, Google, DeepSeek, Moonshot,
Z.AI, Mistral/Codestral, xAI, MiniMax, Alibaba/Qwen, Cohere and AI21.

The filter checks both provider metadata and model ownership. Google uses the Gemini API
price table; marketplace and reseller entries are excluded, including third-party models
hosted by Mistral or Alibaba. Provider aliases are normalized to one native billing channel.
Unknown providers and models without usable token rates stay unpriced.

You can build the database now or continue with saved prices and user overrides. Prices
are cached for 7 days at `<toksight-dir>/cache/litellm-pricing.json`; `--offline` reads saved
prices without making a network request. Setup and automatic-update preferences are saved
in the database, independently of the browser. Updating prices does not scan agent files.

Changed rates are recorded with the local observation time. Requests use the latest rate
observed on or before their timestamp; requests before the first observation use the earliest
known rate as a reference. Unchanged prices do not create revisions. History travels with
SQLite backups, but cannot reconstruct price changes missed between local updates.

**User overrides** have the highest priority. Edit `<toksight-dir>/pricing.json` (USD per
million tokens):

```json
{
  "my-model": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }
}
```

Names match exactly or by an unambiguous provider suffix (`zhipuai/glm-5.3` can also cover
`GLM-5.3`). The original catalog ID is matched before normalized aliases. Dated snapshots
retain their own prices; date-free aliases require a catalog name or equivalent prices for
the same model and provider. Fine-tuning prefixes remain distinct.

Codex session provider IDs, OpenCode message providers, Kimi request providers (when safely
associated with usage) and ZCode rollout providers are retained. To map a custom agent
provider to a native API reference, create `<toksight-dir>/providers.json`:

```json
[
  { "client": "codex", "providerId": "myproxy", "provider": "openai", "since": "2026-10-01T00:00:00Z" }
]
```

Bindings optionally filter `model` and use inclusive `since` / exclusive `until` instants
with an explicit timezone. Overlapping equally specific bindings stay unresolved. Refresh
usage or update prices after editing. Unknown custom providers require a binding or a
`pricing.json` override; today's agent configuration is never applied to all past sessions.
A binding requests the native API reference price, rather than a quote for the proxy.

Kimi Code's versioned IDs `kimi-code/k3` and `kimi-code/k3-256k` resolve to the
`moonshot/kimi-k3` reference price, following the official
[model mapping](https://www.kimi.com/code/docs/en/kimi-code/models.html). Original usage IDs
are preserved. Exact endpoint prices take precedence within a source, and user overrides
remain highest priority. This requires a Moonshot catalog rate or a user override. The cost
is an API reference estimate, not Kimi Code subscription spending or quota consumption.
Rolling IDs such as `kimi-code/kimi-for-coding` stay unpriced unless explicitly priced.

LiteLLM's standard long-context fields (`*_above_200k_tokens`, for example) and Qwen
`tiered_pricing` range tables apply per request
using fresh input + cache read + cache write tokens, excluding output. The highest crossed
threshold selects the rates for the whole request; xAI uses inclusive thresholds. Missing
tier output/cache prices retain published base rates; a missing cache rate at both levels
falls back to the selected input rate. Cache duration and service-tier adjustments are not
inferred. Range tables keep an exact upper boundary in the lower tier (32,000 stays in
`(0, 32000]`); their missing cache prices use that tier's input rate. Reported costs and user
overrides keep their priority.

If a model ID spans different rates, `pricing.modelRates` marks `variableRates` and omits a
single unit price. Requests use their original model IDs for pricing before display grouping.
The saved catalog retains provider, original names, USD-per-token rates and context tiers;
`price_updates` records fetch/check status. Backups retain accepted prices and history.

`<toksight-dir>` is `TOKSIGHT_CONFIG_DIR` when set; otherwise it is
`$XDG_CONFIG_HOME/toksight` when set, or `~/.config/toksight`. Models without a price still
count toward tokens; their cost shows as `—` and they appear in `pricing.unpricedModels`.
OpenCode SQLite `cost: 0` is a placeholder; only nonzero database costs are treated as reported,
while numeric legacy JSON costs are preserved. Missing LiteLLM cache prices fall back to the
input rate and are counted in `costCoverage.cacheFallbackRequests`; this can overestimate
cache-read costs. Reference estimates do not represent historical or subscription bills.

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
filters. It includes session titles/directories, imported usage, prices and cost provenance;
agent files, credentials and browser preferences are not included. Run refresh first if you
want to collect new sessions before exporting. **Import database** accepts a toksight `.sqlite`
or `.db` file (up to 256 MB), shows the merge behavior, then imports transactionally. Invalid or
unsupported databases leave existing data intact. Results show added, updated and duplicate
records; the report moves to the backup's latest usage period.

Imports **merge and deduplicate**; they never replace the destination database. Usage
records match on agent, session ID, timestamp, model and token counts, preserving the largest
occurrence count of identical requests across backups. Paths and titles do not affect matching.
Existing reported costs and conflicting price records win; a reported cost can fill an estimate.
Changed usage fields cannot be recognized as the same
request and may count again. Imported history survives refresh, appears in CLI reports and can
be exported again. Estimates can change when local prices update.

The same operations are available as `toksight export-db <file>` and `toksight import-db <file>`
(`--json` prints transfer statistics). Export requires an existing snapshot (`toksight refresh`
creates one) and refuses to overwrite an existing file. Transfers reject date/client filters.
The web endpoints are `GET /api/export/db` (SQLite download) and `POST /api/import/db` (raw SQLite
bytes, merge statistics as JSON); both retain the local Host check and import requires a permitted
origin. Transfers work offline and never write agent files.

**Reset price database** beside **Update prices** in the top bar of the **Prices** page clears saved rates, observed price history,
the downloaded LiteLLM cache and stored fallback rates, then returns to price setup.
The confirmation dialog shows what will be cleared and keeps any error visible for retry.
Confirm the reset and choose **Build price database** to fetch fresh prices, or continue locally
with your custom pricing. Historical estimates will be recalculated;
usage, reported costs, database imports, selected sources, `pricing.json` and
`providers.json` are preserved. This resets the price data inside the shared `usage.sqlite`,
not the usage database file. Export a database backup first if you want to retain price history.

The CLI equivalent is `toksight reset-prices` (supports `--json` and works offline), followed
by `toksight web` to rebuild. It accepts no date or client filters. Close other toksight
processes before running the CLI reset. Web uses `POST /api/prices/reset`; it returns setup
status with `completed: false` and rejects a reset with HTTP 409 while that server is refreshing or updating prices. Reset itself does not scan agents or access the network.

The **Update prices** button calls `POST /api/prices/update` to download LiteLLM prices
on this machine, bypassing the 7-day interval. **Prices** in the left navigation shows
current official first-party rates in USD per million tokens as one card per model, grouped by
provider (providers you used first) with provider chips and a search box: catalog IDs that
name the same model at the same rates (provider prefixes, dated snapshots) are merged. Cards show
input, cache read/write and output rates (2–4 decimals), a long-context tier badge and, when known,
the maximum input. It shows the models you used by default; turn off **Only models you used** to
browse the full catalog, where each provider previews five cards with a **View all** tile. Expand
**Price details** on a card for tiers and other billing conditions, catalog IDs, the log names that
matched it, and its source. The settings button in the page head holds price sources and automatic updates.
Browsing prices reads only the local database. When automatic updates are enabled, the server
checks hourly as well as on startup/report requests; expired sources refresh and failed checks
retry after an hour. Checks stop when the server closes. Price changes revalue the applicable
requests without rescanning usage or replacing reported amounts. `--offline` prevents network
updates. Continuing with local prices during setup defers the first automatic check for an hour.
`GET /api/prices/status` returns setup/update status; `POST /api/setup` completes setup or updates
the automatic-update preference. `GET /api/prices` reads the catalog (`records`, plus `models`: one merged row per model with
`names`, `ids` and `used`); add `key=<record id>` to read a model's revisions, newest first. API token rates remain USD per token.
Records may carry `maxInputTokens` / `maxTokens` (LiteLLM's `max_input_tokens` / `max_tokens`, positive
integers, omitted when unknown; they never create a price revision), and each merged model row carries
`usedAs`: the sorted model names from your logs that resolved to it (`[]` when unused). These endpoints
use the existing Host/Origin checks.

The UI lives in `frontend/` and follows a plain, dense "Plain Workbench" design language: one sans-serif family (bundled
Geist with a Chinese sans fallback) and tabular figures throughout, flat panels on a plain page, one accent colour, and
light and dark themes with a collapsible sidebar.
The dashboard opens on **Today**, with **Calendar**, **Prices** and **Settings** in the sidebar; the sidebar foot shows
the privacy note, the reporting time zone and the collapse button.
There are no page banners: content starts right under the top bar, which holds the logo (back to Today), the page
actions (**Export image** and **Refresh database** on reports; **Reset price database** and **Update prices** on Prices),
the theme menu (light / dark / system), the 中文 / EN switch and the GitHub link. Every top-bar control is an icon
button whose name appears in a tooltip on hover or keyboard focus. On phones, a sticky
horizontal navigation keeps all four views within reach. See `design-spec.md` for the visual specification.

- **Today** covers all agents. A KPI panel headed by the date and "as of" time shows tokens and reference cost,
  with cache hit rate and requests alongside, followed by hourly
  activity with Tokens / Cost controls, a token-mix bar, expandable agents and models, up to ten sessions
  (five initially, with an expand control), quota, and the last-30-days trend at the bottom. Token/cost changes compare
  with the previous full day when a baseline exists. Single-model agents show the model name directly;
  multi-model agents expand to list their models (there is no separate model ranking). Charts show quantity scales and the hourly peak.
  Session details include title, usage, cost, time span, active time, directory and models.
- **Calendar** is one continuous, scrollable list of months from your first record to today (all agents),
  with Monday-start weeks and an eighth ISO-week column (`W43`; `26W1` when the week belongs to another
  year). Cells show tokens and cost shaded on one heat scale for the whole history. Two zoom levels — large
  (one month per row) and compact (three months per row, colour only) — switch with the zoom buttons,
  Ctrl/⌘ + wheel, pinch or `+` / `-`, with an animated transition (skipped under reduced motion); the level
  is remembered. Click a day, drag or Shift+click for a range, Ctrl/⌘+click to add or remove days, click a
  week number for the whole week (Ctrl/⌘ appends it); arrows, Home/End, PageUp/PageDown, Enter and Esc
  (back to today) work from the keyboard, and the focus ring stays visible outside a selected day's frame.
  The detail pane beside it shows the selection's totals, the hourly
  strip for a single day, and the usage split by agent and by model (the same model used from several agents is
  one row); **View sessions** swaps the split for the sessions list. The split's scroll area takes Tab focus and
  scrolls with the arrow and Page keys. Below 1200px the calendar (70% of the
  viewport height) stacks above the details.
- **Settings** contains appearance, language, the reporting time zone, and database import/export.

The time zone defaults to the browser's detected zone and can be set explicitly, for example
`Asia/Shanghai` when the operating system is set to US time. Today, date boundaries, hourly
buckets and displayed timestamps all use that zone. Clock changes are handled automatically;
the UI uses the same daily view throughout the year. The choice is saved in this browser.
Today and rolling ranges advance at midnight; returning to the browser or refreshing also
updates the date. Changing the reporting zone never changes agent records or the CLI's dates.

Tokens and cost always appear together. Click the Tokens or Cost table header to sort; click
an agent to expand its models. Each row's **ⓘ** button opens inline details by click, Enter or Space,
including token classes, requests and sessions, even when a narrow table hides those columns;
model details also show matching unit rates. Hover hints remain available.
Models beyond the first seven fold into an eighth summary row.
Theme, language, time zone, calendar zoom level and table sorting are remembered in `localStorage`.
The calendar selection stays in page memory; reloading opens Today.

**Export image** saves the visible Today report, or the months visible in the Calendar plus the detail pane,
as one PNG with date, Agent, time zone and footer. Controls and temporary row details are excluded; expanded models stay
expanded in the image. Export waits until all displayed data has loaded. Cost totals combine
reported amounts and estimates; they are not a subscription bill. Unpriced models remain listed
in the footer. The frontend remains a static export using the local API.

Startup filters (`--client`, `--since`, `--until`, `--today/--week/--month`) bound the data the
server can see; the report never widens that scope.

The API accepts e.g. `GET /api/data?period=custom&since=2026-09-01&until=2026-09-30` (what the
report requests; the calendar asks for its selection the same way) or `?client=claude&period=7d`. `period` is `all` (default) / `today` / `7d` /
`30d` / `month` / `custom` (`custom` needs both `since` and `until`); `since`/`until` may also be
used alone; presets cannot combine with explicit dates. Optional `timezone=Asia%2FShanghai` selects
an IANA reporting zone for filters and all calendar/hour aggregates; omission preserves the
server-local default. Optional `days=2026-10-06,2026-10-08` (comma-separated `YYYY-MM-DD` local
days in the reporting zone, at most 4000; sorted and de-duplicated) keeps only those days within the
other filters — it never widens them — and the response's `view.days` echoes the list (`null` when absent).
Unknown, duplicate or invalid parameters (including a malformed `days` list)
return HTTP 400. `POST /api/refresh` updates the database and returns its refresh time and entry
count and collection warnings. The web API's additive `snapshot` field exposes the refresh time
and count. `POST /api/prices/update` refreshes LiteLLM prices locally without rescanning
usage. `GET /api/quota` returns local quota data and `POST /api/quota/refresh` also queries Kimi Code.
Cross-origin write requests are rejected.

### Dashboard bundle

`frontend/` is the only frontend source, dependency, build and release directory; the old `web/` directory has been removed.
Use `npm run frontend:ci`, `npm run frontend:dev`, and `npm run frontend:build`; existing `web:*` commands remain aliases for the new frontend.

The npm package ships with the prebuilt static files in `frontend/out/` — installed users just run
`toksight web`, no build and no Next runtime. To preview the production dashboard from a source
checkout (requires Node >=22.5):

```bash
npm run web:ci && npm run web:build && node bin/toksight.js web
```

Until `frontend/out/` exists, `toksight web` serves a setup-instructions page at `/` while
`/api/data` keeps working. `web:build` only builds (it never installs); rebuild and refresh
after editing the frontend. `npm pack` and `npm publish` rebuild the dashboard automatically.

### Cache hit rate

`cacheRead / (freshInput + cacheRead)` — the share of prompt tokens served from cache. Cache
*writes* are excluded (they are cold traffic being stored, not served). Stats are attributed per
request, so a session that switched models splits cleanly across the per-agent / per-model views —
a model's cache can only ever hit for that same model, so request-level attribution is exact.
ZCode reports `input_tokens` as the whole prompt with cache reads included, so toksight subtracts
them to expose fresh input and keep this formula meaningful across agents.

## Privacy

toksight is local-first: the CLI and web report only **read** your agents' session files. Refresh
writes toksight's own SQLite database under its config directory; price fetches may update local
cache files. toksight does not upload usage or write back to agent files. If you change
`--host`, other clients on that network may read the report/API. External requests download
the LiteLLM price table; `--offline` disables these requests. `toksight quota` and the web
**Refresh Kimi quota** button also call the Kimi Code usage API with your local Kimi Code token. Report images are
rendered in your browser and saved only where you download them.

## JSON output

Report commands accept `--json` (e.g. `toksight daily --json`). Shape: `totals`, `cacheHitRate`,
`clients`, `models`, `daily`, `monthly`, `sessions`, `pricing` (incl. `unpricedModels`), `warnings`.
Each `clients` entry is that agent's totals plus its own `cacheHitRate`; the map is built from the
filtered entries, so `--client` / `--since` / `--until` apply to it like every other slice.
Each `models` row is grouped by agent and display name, with `modelIds` listing the original IDs;
`pricing.modelRates` keeps per-ID pricing details. Display grouping never changes request costs.
`toksight refresh --json` instead returns the database path, refresh time, entry count and warnings.
`toksight quota --json` returns `{ tool, version, generatedAt, quotas }`; each quota has `client`, `plan`,
`source` (`local`/`api`), `fetchedAt`, `observedAt`, `windows` (`id`, `label`, `windowMinutes`, `usedPercent`,
optional `used`/`limit`/`remaining`, `resetsAt`, `reset`) and an optional `error` `{ code, message }`.

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

Use `dev` for daily development and development PRs. `release` is the repository's
default branch and receives release and maintenance PRs. Push development commits
with `git push origin dev`; prepare a PR targeting `release` when ready to publish.

```bash
npm test             # node:test suite with per-client fixtures (no network needed)
node bin/toksight.js # run the CLI from source
npm run web:ci       # install locked web dependencies from frontend/package-lock.json
npm run web:dev      # API (4729) + Next dev server (3000) together, with hot reload
```

Open `http://127.0.0.1:3000`; no `frontend/out/` build needed. Ctrl+C stops both; an occupied port
errors out and shuts down the services the command started.
`npm run web:dev -- --port 3001 --api-port 4730 --offline` overrides the two ports and skips the
pricing fetch. For two-terminal work run `node bin/toksight.js web --api-only` plus
`npm run web:dev:ui` (proxy overridable via `TOKSIGHT_DEV_API`, dev-server only — production
builds always export static files). `web:install` remains for updating web dependencies.

Codex browser automation is configured per project in [`.codex/config.toml`](./.codex/config.toml)
using Playwright MCP. Trust the project and restart your Codex session, then check `/mcp`.
See the [development guide](./doc/development-release.md#playwright-mcp) for setup and usage.

The CLI keeps **zero runtime dependencies**; dashboard dependencies live only in
`frontend/package.json`, needed just to (re)build `frontend/out/`. The flows: session files →
parsers → `collectAll` → CLI output or SQLite refresh → `/api/data`; `frontend/` source → Next build → `frontend/out/` →
the CLI's HTTP server. Developer architecture, data contracts and maintenance notes are indexed in
[doc/README.md](./doc/README.md); short agent rules live in [AGENTS.md](./AGENTS.md).

```bash
npm run check:package # pack, install the tarball offline in a temp dir, then exercise
                      # the page, JS/CSS/fonts and the data API against fixtures
```

It needs network only to install locked web dependencies, uses throwaway agent fixtures (never
your real sessions), and cleans up afterward. PR and dev-branch CI, plus the Release workflow, run the test suite and
this check on Ubuntu/Windows.

### Releasing

Open a PR targeting `release` with the code to publish and an explicit stable version.
For example, `npm run release:version -- 1.1.0` updates both manifests and lockfiles.
PR CI checks version consistency, tests, and the installed package. Once merged, the
Release workflow repeats those checks, then publishes the matching version to npm and
GitHub Releases. A PR without a version change does not publish. After merging into
`release`, merge `origin/release` back into `dev` and push `dev` to keep it up to date.

See the [release guide](doc/release.md) for branch protection, npm Trusted Publishing setup, failure recovery, and verification.

### Roadmap

- [x] Web dashboard (`toksight web`, phase 2)
- [x] Today / Calendar / Prices / Settings workspace with adjustable time zone and image export (`toksight web`)
- [ ] TUI watch mode
- [ ] More clients (Windsurf, pi…)
- [ ] `--export csv`, leaderboard-style sharing

## License

MIT. Not affiliated with Zhipu AI, Anthropic, OpenAI or any agent vendor.

Provider and model logos on the Prices page come from [LobeHub Icons](https://github.com/lobehub/lobe-icons)
(MIT License, © LobeHub); see `frontend/public/logos/LICENSE.txt`. The marks remain the trademarks of their owners.
