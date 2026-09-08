# 🔭 toksight

**Track token usage, cost and cache hit rate of AI coding agents — right from your terminal.**

toksight reads the local session files your AI coding agents already write and turns them into
totals, per-model / per-day / per-session breakdowns and cost estimates. It is a Node.js CLI with
zero runtime dependencies, plus a local web dashboard (`toksight web`) for visual exploration.

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

## Install

```bash
npm install -g toksight
# or one-off
npx toksight
```

Requires Node.js >= 20. On Node >= 22.5 the ZCode and OpenCode SQLite databases are read with the
built-in `node:sqlite`; older versions automatically fall back to ZCode rollout logs and OpenCode's
legacy JSON storage.

## Usage

```bash
toksight              # overview: totals + per-client + top models
toksight daily        # grouped by local day
toksight monthly      # grouped by month
toksight models       # grouped by model
toksight sessions     # top sessions by cost
toksight web          # local web dashboard (heatmap, trend & model analytics)
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
codex   gpt-5.6-sol         62   183K    1.79M        0   25.7K  90.8%    $1.96
zcode   glm-5.3-flash      487  2.51M   28.45M        0    442K  91.9%    $1.45
zcode   glm-5.3             41   116K    1.99M        0   43.3K  94.5%   $0.870
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
--no-open        do not open the browser automatically (web only)
--api-only       web: serve only the JSON API, no static dashboard
--offline        skip the LiteLLM pricing fetch
--no-color       disable ANSI colors
```

Value options accept both forms: `--since 2026-08-01` and `--since=2026-08-01`.

Day grouping and date filters use your **local** timezone.

## Pricing

Costs are computed per request from token counts, with three layers (later wins):

1. **Built-in table** — best-effort USD-per-MTok estimates for common model families,
   always available offline.
2. **LiteLLM** — fetched from the community
   [model prices](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
   list with a 1-hour disk cache at `<config>/toksight/cache/litellm-pricing.json`. This is the
   freshest source; skip it with `--offline`.
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

When a LiteLLM entry has no separate cache prices, cached tokens are billed at that model's input
price — a deliberately conservative overestimate (real cache reads are usually ~10% of the input
price) so costs are never silently undercounted. Models with proper cache prices price normally.

## Web dashboard

`toksight web` starts a small local server (zero-dependency `node:http`) that serves a
statically-exported [Next.js](https://nextjs.org) dashboard plus a live JSON API, then opens your
browser (default `http://127.0.0.1:4729`). It binds to localhost only and re-aggregates your
session files on every request — data never leaves your machine.

The dashboard is a Brutalism phosphor worksheet (v6): a 2px-framed mosaic on a near-black
page, cells split by hard `--color-border-strong` grid lines, square corners, Geist Mono for
data. Construction spec is `design-spec.md`; `design-system/toksight/MASTER.md` is a
projection of that spec (not a raw skill dump). A sticky masthead (lime logo chip +
last-fetch time) leads filters, a 4-cell KPI strip, cost details and period comparison, then a 12-column sheet — trend first (direction
before detail), activity heatmap, agent/model split, hourly/monthly/pace, and a sessions
table. Hover is instant invert; the few remaining motions (row expand, chart replay when
*you* switch range or mode) are disabled under `prefers-reduced-motion`. It includes:

- **Dashboard filters** — all available data / today / last 7 days / last 30 days / this month /
  custom dates, plus agent selection. Apply updates totals, charts, models and sessions together;
  filters are stored in the page URL and survive reloads.
- **KPI strip** — total tokens (lime, with requests · sessions), reference cost, cache hit rate
  (green), active days as 34px mono numbers
- **Trend cell** — 7 / 30 / 90-day windows crossed with two stack modes: by token class (fresh
  input / cache reads / cache writes / output) or by agent; bands are per-day step-after
  solids (not a smooth mountain); legend chips toggle series; today / 7d / 30d / this-month
  square summary chips sit in the header
- **Selected period** — date filters give the trend and heatmap the selected window. Charts show
  the last 366 days for longer selections, with a notice; totals and comparison keep the full range.
  Dates use the server machine's timezone; impossible dates such as February 30 are rejected.
- **Reference cost details** — separate agent-reported amounts, user overrides, LiteLLM and
  built-in estimates, with priced-request coverage, unpriced requests and requests actually using
  fallback cache prices. Reference cost is not a subscription bill or actual charge; unpriced does not mean free.
- **Period comparison** — compare the selection with the immediately preceding equal-length
  local-calendar period. Without a start date, use the 7 days ending on the end date. Show cost,
  tokens, cache hit rate and requests, with agent and agent × model contributions (up to 8 ranked
  by absolute cost change). Both estimates use the same collection's prices; reported amounts
  retain their original values. Incomplete periods, absent/undated records and missing pricing are
  explained; a zero previous cost has no percentage change. This does not measure productivity or model quality.
- **Activity cell** — a GitHub-style heatmap of daily token volume for the last ~53 weeks, with
  per-day tooltips and a lime intensity ramp
- **Agent mix cell** — per-agent share bars (tokens, cost, share) with cache hit rate; click a
  row to expand that agent's per-model hit rates
- **Model usage cell** — models aggregated across agents; every bar splits cache reads (green)
  from fresh traffic; the per-agent×model table remains as a collapsible detail
- **Hourly, monthly, pace** — when tokens move by hour and month, plus current streak, peak day,
  and longest session by *active* time
- **Sessions table** — top 10 sessions by tokens (title, tokens, requests, hit rate, cost,
  start, active duration)

All filters (`--client`, `--since`, `--until`, `--today/--week/--month`) work for `web` too, and
the page offers a manual refresh, a 30s auto-refresh toggle, and a 中文 / EN language switch
(stored in `localStorage` as `toksight-locale`, default Chinese).
Startup filters bound the server's visible scope; dashboard filters only narrow it further.
Clearing dashboard filters does not remove startup restrictions. If the previous period lies
outside the startup date scope, the dashboard explains why a full comparison is unavailable.

The API accepts `GET /api/data?client=claude&period=7d`. `period` can be `all` (default), `today`,
`7d`, `30d`, `month` or `custom`; `custom` requires both `since=YYYY-MM-DD&until=YYYY-MM-DD`.
`since` / `until` may also be used independently. Dates and comma-separated clients follow CLI
semantics. Presets cannot be combined with explicit dates; unknown, duplicate or invalid options return HTTP 400.

### Agent configuration viewer (read-only + transfer)

Open **Config** in the dashboard masthead (or `/config`) for a read-only summary of the five
agents' user-level configuration: default model, auth method, providers and endpoints, the model
list (with context sizes), key settings such as permissions/sandbox, and which file each setting
comes from. Expanding an agent shows redacted raw previews of its files. The **Export, import & restore**
panel at the bottom of the page is the single write path: pack configs into a JSON bundle to
move between machines, preview differences before import, or restore local backups.

Files read (fixed allowlist, all user-level):

| Agent | Files read |
|---|---|
| ZCode | `%ZCODE_HOME%\v2\config.json`, `v2\setting.json`, `cli\config.json`, `v2\credentials.json` (existence probe only; default root `%USERPROFILE%\.zcode`) |
| Claude Code | `%CLAUDE_CONFIG_DIR%\settings.json`, `.claude.json` (state/MCP, home-root by default), `.credentials.json` (probe only; default `%USERPROFILE%\.claude`) |
| Codex CLI | `%CODEX_HOME%\config.toml`, `auth.json` (auth mode only), `.env` (variable names only), `*.config.toml` profiles (default `%USERPROFILE%\.codex`) |
| OpenCode | `%OPENCODE_CONFIG_DIR%\opencode.json` / `opencode.jsonc`, data-dir `auth.json` (provider names only), state-dir `model.json` (defaults under `%USERPROFILE%\.config\opencode` etc.; `OPENCODE_CONFIG` override supported) |
| Kimi Code | `%KIMI_CODE_HOME%\config.toml`, `tui.toml`, `mcp.json`, `region`, `credentials\kimi-code.json` (probe only; default `%USERPROFILE%\.kimi-code`) |

Credential files are **never displayed** — only their existence is reported, plus whitelisted
facts such as Codex's `chatgpt` / `apikey` auth mode or OAuth state. Previews of regular config
files replace secret-bearing values with `[REDACTED]`; Claude's `settings.json` `env` block is
judged per variable name (`ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` visible,
`ANTHROPIC_API_KEY` hidden), so third-party relay setups stay readable. Project-level config and
managed/enterprise policy files are out of scope. The configuration API accepts loopback clients
with a localhost `Host` header only, even when `--host` exposes the statistics dashboard more
broadly.

#### Config bundling & import

The **Export, import & restore** panel at the bottom of the config page migrates agent configuration
between machines:

- **Export**: pick the config files to carry over (credential files never appear in the list and
  can never be bundled), then download a single JSON bundle (`toksight-agent-configs.json`) or
  copy the JSON text to paste it elsewhere. Bundled configs are **unredacted originals** (a
  migration needs the real values, including provider keys you configured) — store them safely.
- **Import**: choosing a file parses and previews it automatically; pasted JSON uses
  **Preview / refresh differences**. Review each local target and its new / modified / unchanged /
  blocked status, with redacted line differences (up to 64 KB / 600 lines per side). Unchanged
  files are skipped without a backup. Changes hidden by redaction or formatting are explained.
  Confirm to apply. Existing files are
  backed up to `<config>/toksight/backups/<agent>/` before being atomically replaced
  (temp file + rename — no half-written truncation). Backup names include a timestamp and random
  suffix; exclusive copying prevents subsequent imports from overwriting an existing backup.
- **Preview validity**: the dashboard sends the target and source content revisions from its
  preview. A changed revision refuses that file and requires another preview. Unreadable local
  targets and targets over 1 MB are also refused. Absolute paths, environment references,
  external commands and detectable syntax issues prompt manual review; paths are not rewritten,
  programs are not installed, and successful migration does not guarantee a working setup.
- **Restore backups**: open Restore backups to see the latest 200 recognized backups → preview
  restore → confirm. Restoring backs up the current file first, so the restore itself can be
  undone. Listings contain metadata only and previews remain redacted. Legacy backups are
  supported only when their target is unambiguous; old ZCode backups for its two `config.json`
  files are omitted with a warning when their destinations cannot be distinguished.
- **Scope**: imports only accept allowlisted **config** files from the bundle — unknown and
  credential entries are always skipped, and write targets are resolved from THIS machine's
  allowlist (the source paths recorded in the bundle are informational only), so a bundle cannot
  write anywhere outside the known config files. Symlinked targets are refused (the import would
  replace the link itself, not the file it points at); a failed write leaves no temp file behind
  and reports the backup it already made.
  Skills, rule files and plugin resources are outside the bundle. Symlinked backup directories
  and backup files are refused for automatic restoration.
- **Security**: export/import endpoints require loopback clients + a localhost `Host` header
  like the inventory, plus a browser `Sec-Fetch-Site` check; import endpoints additionally
  require `application/json` + a dedicated request header (a foreign web page cannot forge
  either), and request bodies are capped at 10 MB.

### Dashboard bundle

The npm package ships with the prebuilt static files in `web/out/`, so installed users can start
it directly:

```bash
toksight web
```

To preview the production dashboard from a source checkout, install the locked web dependencies,
build, and start from the repository root:

```bash
npm run web:ci
npm run web:build
node bin/toksight.js web
```

`npm pack` and `npm publish` rebuild the dashboard automatically. Until `web/out/` is built in a
source checkout, `toksight web` serves a setup-instructions page at `/` while `/api/data` keeps
working. Refresh the page after building.
`web:build` builds only; it does not install dependencies. Rebuild after editing the frontend to
see changes in this server. Source dashboard development/builds require Node >=20.9 (Node 22 or
24 recommended); the installed CLI still supports Node >=20.

Options: `--port <n>` (default 4729), `--host <addr>` (default 127.0.0.1),
`--no-open` (skip auto-opening the browser), `--api-only` (JSON API without the dashboard, for
manually starting the frontend and backend separately). The configuration inventory
endpoint is loopback-only regardless of `--host`.

### Cache hit rate

`cacheRead / (freshInput + cacheRead)` — the share of prompt tokens served from cache. Cache
*writes* are excluded (they are cold traffic being stored, not served). Stats are attributed per
request, so a session that switched models splits cleanly across the per-agent / per-model views —
a model's cache can only ever hit for that same model, so request-level attribution is exact.
ZCode reports `input_tokens` as the whole prompt with cache reads included, so toksight subtracts
them to expose fresh input and keep this formula meaningful across agents.

## Privacy

toksight is local-first: usage statistics and the configuration page only **read** local files on
your machine — nothing is uploaded. The single external network call is the anonymous LiteLLM
pricing fetch; run `--offline` to disable even that. The only writes to agent configuration are
explicit imports you start on the config page (backup-first, allowlisted files only); credential
files are never exported.

## JSON output

Every command accepts `--json` (e.g. `toksight daily --json`). Shape: `totals`, `cacheHitRate`,
`clients`, `models`, `daily`, `monthly`, `sessions`, `pricing` (incl. `unpricedModels`), `warnings`.
Each `clients` entry is that agent's totals plus its own `cacheHitRate`; the map is built from the
filtered entries, so `--client` / `--since` / `--until` apply to it like every other slice.

`warnings` surfaces collection problems (a directory that cannot be read, a SQLite database that
exists but cannot be opened) and data caveats — notably, entries without a timestamp that were
excluded by `--since` / `--until` are reported there instead of disappearing silently.

The web dashboard consumes the same payload (plus web-only extras such as `heatmap`, `trend`,
`trend7`, `trend90`, `trendByAgent`, `hourly`, `today`, `last7Days`, `last30Days`, `thisMonth`,
`activeDays`, `streaks`, `peakDay`, `topSessions`, `longestSession`, `activityRange`, `timezone`)
from `GET /api/data` on its own origin. Session rows carry both `durationMs` (raw wall-clock span)
and `activeMs` (inter-request gaps capped at 5 minutes); `longestSession` ranks by `activeMs`, so
a session left open overnight no longer counts its idle hours.

The web API additionally exposes `view` (server date, selectable agents and startup scope),
`selection` (selected trends/heatmap, null without date filters), `costCoverage` (cost sources,
unpriced and fallback-cache request counts), and `comparison` (current/previous periods, deltas
and contributions, or an unavailable reason). Existing CLI `--json` fields are unchanged.

## Development

```bash
npm test        # node:test suite with per-client fixtures (no network needed)
node bin/toksight.js   # run from source
npm run web:ci  # install web dependencies from web/package-lock.json
npm run web:dev # start the API and frontend together, with hot reload
```

Open `http://127.0.0.1:3000`; the frontend proxies the API at `127.0.0.1:4729`.
No `web/out/` build is needed. Ctrl+C stops both services; an occupied port reports an error
and shuts down services started by the command.

```bash
npm run web:dev -- --port 3001 --api-port 4730 --offline
```

`--port` sets the frontend port, `--api-port` sets the API port, and `--offline` disables the
development API's pricing fetch. To manage the services separately, run
`node bin/toksight.js web --api-only` and `npm run web:dev:ui` in two terminals from the repository
root. That mode accepts `TOKSIGHT_DEV_API` as its proxy target. This variable only affects the
development server; production builds always emit static files.
`web:install` remains available for developers updating web dependencies with `npm install`.

```
bin/toksight.js        executable entry
src/cli.js             command dispatch and web service startup
src/collect.js         shared CLI/web collection, filtering and pricing pipeline
src/args.js            CLI argument parsing (--flag value / --flag=value)
src/render.js          text rendering (tables, sections, warnings)
src/payload.js         the --json / web API payload contract
src/dates.js           shared local-time date helpers (DST-safe)
src/agentconfigs.js    fixed-allowlist config reading + structured summaries (with src/toml.js TOML parsing)
src/agenttransfer.js   config bundle export + import (backup-first atomic replace, the only write path)
src/config/           implementation: files allowlist, redact, inventory, summaries, compare,
                      backups and transfer; the two entry points above keep compatible exports
src/pricing.js         built-in table + LiteLLM cache + user overrides
src/aggregate.js       grouping/totals
src/webdata.js         web-dashboard aggregations (heatmap, trend, sessions…)
src/webservice.js      shared concurrent collection with independently filtered web payloads
src/webquery.js        dashboard query validation and startup-scope intersection
src/comparison.js      adjacent calendar-period comparison and contributions
src/costcoverage.js    reported/estimated cost sources and missing-pricing coverage
src/webserver.js       zero-dependency HTTP server for `toksight web`
src/format.js          ANSI tables & number formatting
src/fsutils.js         walkFiles, readJsonl, readJson, pathExists
src/clients/           one parser per agent, normalized to a common entry shape
                       (+ shared src/clients/sqlite.js read-only opener)
web/                   Next.js dashboard + /config page (static export served by the CLI)
scripts/               source development, web build and package checks (not shipped in npm)
```

The CLI itself keeps **zero runtime dependencies**; the dashboard's dependencies live only in
`web/package.json` and are needed just to (re)build `web/out/`.

The three flows are: session files → parsers → `collectAll` → CLI output or `/api/data`;
configuration files → fixed allowlist → inventory/transfer services → `/api/config`;
and `web/` source → Next build → `web/out/` → the CLI's HTTP server.
Next is only used for source development and building; installed users do not run a Next server.

```bash
npm run check:package # build, pack, install temporarily, then check pages, assets and APIs
```

This installs locked web dependencies (network needed initially), installs the resulting package
offline, checks both pages, JS/CSS/fonts, APIs and an import/restore round trip using temporary agent fixtures,
then removes the temporary installation. It never imports real configuration. PR and main-branch
CI run the tests and package checks on Ubuntu/Windows.

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
- [x] Read-only agent configuration viewer: summaries + redacted previews (`toksight web` → Config)
- [x] Config bundling / import: bundle export + preview + backup-first replace (`toksight web` → Config)
- [ ] TUI watch mode
- [ ] More clients (Cursor, Windsurf, pi…)
- [ ] `--export csv`, leaderboard-style sharing

## License

MIT. Not affiliated with Zhipu AI, Anthropic, OpenAI or any agent vendor.
