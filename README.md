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
last-fetch time) leads a 4-cell KPI strip, then a 12-column sheet — trend first (direction
before detail), activity heatmap, agent/model split, hourly/monthly/pace, and a sessions
table. Hover is instant invert; the few remaining motions (row expand, chart replay when
*you* switch range or mode) are disabled under `prefers-reduced-motion`. It includes:

- **KPI strip** — total tokens (lime, with requests · sessions), total cost, cache hit rate
  (green), active days as 34px mono numbers
- **Trend cell** — 7 / 30 / 90-day windows crossed with two stack modes: by token class (fresh
  input / cache reads / cache writes / output) or by agent; bands are per-day step-after
  solids (not a smooth mountain); legend chips toggle series; today / 7d / 30d / this-month
  square summary chips sit in the header
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

### Dashboard bundle

The npm package ships with the prebuilt static files in `web/out/`, so installed users can start
it directly:

```bash
toksight web
```

When working from a source checkout, install the dashboard's build-only dependencies and build it
once:

```bash
npm run web:install
npm run web:build
```

`npm pack` and `npm publish` rebuild the dashboard automatically. Until `web/out/` is built in a
source checkout, `toksight web` serves a setup-instructions page at `/` while `/api/data` keeps
working.

Options: `--port <n>` (default 4729), `--host <addr>` (default 127.0.0.1, loopback only),
`--no-open` (skip auto-opening the browser), `--api-only` (JSON API without the dashboard, used
for UI development — run it alongside `npm run web:dev` in `web/`).

### Cache hit rate

`cacheRead / (freshInput + cacheRead)` — the share of prompt tokens served from cache. Cache
*writes* are excluded (they are cold traffic being stored, not served). Stats are attributed per
request, so a session that switched models splits cleanly across the per-agent / per-model views —
a model's cache can only ever hit for that same model, so request-level attribution is exact.
ZCode reports `input_tokens` as the whole prompt with cache reads included, so toksight subtracts
them to expose fresh input and keep this formula meaningful across agents.

## Privacy

toksight is local-first: it only **reads** session files on your machine and never sends your data
anywhere. The single network call is the anonymous LiteLLM pricing fetch; run `--offline` to
disable even that.

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

## Development

```bash
npm test        # node:test suite with per-client fixtures (no network needed)
node bin/toksight.js   # run from source
npm run web:install # install dashboard build dependencies
npm run web:dev # develop the dashboard UI (needs `toksight web --api-only` running)
```

```
bin/toksight.js        executable entry
src/cli.js             command dispatch + collection pipeline (collectAll)
src/args.js            CLI argument parsing (--flag value / --flag=value)
src/render.js          text rendering (tables, sections, warnings)
src/payload.js         the --json / web API payload contract
src/dates.js           shared local-time date helpers (DST-safe)
src/pricing.js         built-in table + LiteLLM cache + user overrides
src/aggregate.js       grouping/totals
src/webdata.js         web-dashboard aggregations (heatmap, trend, sessions…)
src/webserver.js       zero-dependency HTTP server for `toksight web`
src/format.js          ANSI tables & number formatting
src/fsutils.js         walkFiles, readJsonl, readJson, pathExists
src/clients/           one parser per agent, normalized to a common entry shape
                       (+ shared src/clients/sqlite.js read-only opener)
web/                   Next.js dashboard (static export served by the CLI)
```

The CLI itself keeps **zero runtime dependencies**; the dashboard's dependencies live only in
`web/package.json` and are needed just to (re)build `web/out/`.

### Roadmap

- [x] Web dashboard (`toksight web`, phase 2)
- [ ] TUI watch mode
- [ ] More clients (Cursor, Windsurf, pi…)
- [ ] `--export csv`, leaderboard-style sharing

## License

MIT. Not affiliated with Zhipu AI, Anthropic, OpenAI or any agent vendor.
