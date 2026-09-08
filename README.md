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

The dashboard is a Brutalism phosphor worksheet (v6): near-black page, square corners, hard
grid lines, Geist Mono for data; the construction spec is `design-spec.md` (single source of
truth). A sticky masthead (lime logo chip + last-fetch time) leads filters, a 4-cell KPI strip,
cost details and period comparison, then a 12-column sheet — trend first (direction before
detail), activity heatmap, agent/model split, hourly/monthly/pace, sessions table. Hover is
instant invert, and all motion respects `prefers-reduced-motion`. It includes:

- **Dashboard filters** — all data / today / last 7 days / last 30 days / this month / custom
  dates, plus agent selection. Totals, charts, models and sessions update together; the
  selection is stored in the page URL and survives reloads.
- **KPI strip** — total tokens (lime, requests · sessions), reference cost, cache hit rate,
  active days.
- **Trend cell** — 7 / 30 / 90-day windows × two stack modes (by token class or by agent) as
  per-day step-after solids; legend chips toggle series; today/7d/30d/this-month chips in the header.
- **Selected period** — date filters re-window the trend and heatmap; selections beyond 366
  days chart only the last 366 (with a notice) while totals and comparison keep the full range.
  Dates follow the server's local timezone; impossible dates such as February 30 are rejected.
- **Reference cost details** — agent-reported amounts, user overrides, LiteLLM and built-in
  estimates, priced-request coverage, unpriced requests, and requests actually using fallback
  cache prices. Reference cost is not a subscription bill; unpriced does not mean free.
- **Period comparison** — the selection against the immediately preceding equal-length local
  calendar period (without a start date: the 7 days ending at the end date). Cost, tokens, cache
  hit rate, requests, plus agent and agent × model contributions (top 8 by absolute cost change).
  Both windows share one price snapshot; reported amounts keep their original values. Incomplete
  periods, absent/undated records and missing pricing are explained; a zero previous cost yields
  no percentage. This does not measure productivity or model quality.
- **Activity heatmap** — GitHub-style 53-week grid of daily tokens with a lime ramp and per-day tooltips.
- **Agent mix** — per-agent share of tokens/cost with hit rates; expand a row for its per-model hit rates.
- **Model usage** — models aggregated across agents; bars hard-split cache reads (green) from
  fresh traffic; collapsible agent × model detail table.
- **Hourly / monthly / pace** — when tokens move by hour and month, current streak, peak day,
  and longest session by *active* time.
- **Sessions table** — top 10 sessions by tokens (title, tokens, requests, hit rate, cost,
  start, active duration).

Startup filters (`--client`, `--since`, `--until`, `--today/--week/--month`) bound the data the
server can see; dashboard filters only narrow within that scope, and clearing them never lifts
the startup restriction — if the previous comparison period falls outside it, the dashboard says
so. The page also offers a manual refresh, a 30s auto-refresh toggle, and a 中文 / EN switch
(`localStorage` key `toksight-locale`, default Chinese).

The API accepts `GET /api/data?client=claude&period=7d`. `period` is `all` (default) / `today` /
`7d` / `30d` / `month` / `custom` (`custom` needs both `since` and `until`); `since`/`until` may
also be used alone; presets cannot combine with explicit dates. Unknown, duplicate or invalid
parameters return HTTP 400.

### Agent configuration viewer (read-only + transfer)

Open **Config** in the dashboard masthead (or `/config`) for a read-only summary of the five
agents' user-level configuration: default model, auth method, providers and endpoints, the model
list (with context sizes), key settings such as permissions/sandbox, and which file each setting
comes from. Expanding an agent shows redacted raw previews of its files. At the bottom of the
page, the **Export, import & restore** panel is the single write path (see below).

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
managed/enterprise policy files are out of scope.

#### Config bundling & import

Three flows, one panel:

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
- **Scope**: imports only accept allowlisted **config** files — unknown and credential entries
  are always skipped, and write targets resolve from THIS machine's allowlist (source paths in
  the bundle are informational), so a bundle cannot write outside the known config files.
  Skills, rule files and plugin resources are outside the bundle. Symlinked targets are refused
  (the swap would replace the link, not its file); so are symlinked backup dirs/files when
  restoring. A failed write leaves no temp file and reports only backups that reached disk.
- **Security**: all config endpoints require loopback clients + a localhost `Host` header (a
  browser `Sec-Fetch-Site` check on top), even when `--host` exposes the stats dashboard more
  broadly; import POSTs additionally require `application/json` + a dedicated request header
  (a foreign page cannot forge either), and bodies are capped at 10 MB.

### Dashboard bundle

The npm package ships with the prebuilt static files in `web/out/` — installed users just run
`toksight web`, no build and no Next runtime. To preview the production dashboard from a source
checkout (requires Node >=20.9; the installed CLI still runs on >=20):

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
`web/package.json`, needed just to (re)build `web/out/`. The three flows: session files →
parsers → `collectAll` → CLI output or `/api/data`; configuration files → fixed allowlist →
inventory/transfer services → `/api/config`; `web/` source → Next build → `web/out/` → the
CLI's HTTP server. Per-module notes live in [AGENTS.md](./AGENTS.md).

```bash
npm run check:package # pack, install the tarball offline in a temp dir, then exercise
                      # both pages, JS/CSS/fonts, APIs and a fixture-only import/restore
```

It needs network only to install locked web dependencies, uses throwaway agent fixtures (never
your real configuration), and cleans up afterward. PR and main-branch CI run the test suite and
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
- [x] Read-only agent configuration viewer: summaries + redacted previews (`toksight web` → Config)
- [x] Config bundling / import: bundle export + preview + backup-first replace (`toksight web` → Config)
- [ ] TUI watch mode
- [ ] More clients (Cursor, Windsurf, pi…)
- [ ] `--export csv`, leaderboard-style sharing

## License

MIT. Not affiliated with Zhipu AI, Anthropic, OpenAI or any agent vendor.
