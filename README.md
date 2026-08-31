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
| OpenCode | `~/.local/share/opencode/storage/message/**/*.json` | `OPENCODE_PATH` |
| Gemini CLI | `~/.gemini/tmp/*/chats/*.json` | `GEMINI_CLI_HOME` |
| Kimi Code | `~/.kimi-code/sessions/**/agents/*/wire.jsonl` | `KIMI_CODE_HOME` |

## Install

```bash
npm install -g toksight
# or one-off
npx toksight
```

Requires Node.js >= 20. On Node >= 22.5 the ZCode SQLite database is read with the built-in
`node:sqlite`; older versions automatically fall back to ZCode rollout logs.

## Usage

```bash
toksight              # overview: totals + per-client + top models
toksight daily        # grouped by local day
toksight monthly      # grouped by month
toksight models       # grouped by model
toksight sessions     # top sessions by cost
toksight web          # local web dashboard (heatmap, charts, session analytics)
toksight env          # show detected data sources + pricing state
```

Example (`toksight`):

```
Tokens 3,668,215  Cost $0.378  36 requests · 1 sessions
input 1.87M · cache read 1.74M (48.2% hit · write 0) · output 55.9K
range: all time · clients: all

By client
Client  Req  Sessions  Tokens    Cost
──────  ───  ────────  ──────  ──────
zcode    36         1   3.67M  $0.378

Top models (up to 20)
Client  Model          Req  Input  Cache R  Cache W  Output    Hit     Cost
──────  ─────────────  ───  ─────  ───────  ──────  ──────  ─────  ───────
zcode   GLM-5.3-Flash   35  1.86M    1.74M        0   55.8K  48.4%   $0.359
zcode   GLM-5.3          1  13.8K        0        0     126   0.0%  $0.0199
```

### Options

```
--client <a,b>   only include these clients (zcode, claude, codex, opencode, gemini, kimi)
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

## Web dashboard

`toksight web` starts a small local server (zero-dependency `node:http`) that serves a
statically-exported [Next.js](https://nextjs.org) dashboard plus a live JSON API, then opens your
browser (default `http://127.0.0.1:4729`). It binds to localhost only and re-aggregates your
session files on every request — data never leaves your machine.

The dashboard includes:

- **Overview stat strip** — all-time tokens & cost, cache hit rate, active days, current/longest
  activity streak, peak day and the longest session, in one compact row (no wall of KPI cards)
- **Activity heatmap** — GitHub-style grid of daily token volume for the last ~53 weeks, with
  per-day tooltips (tokens, cost, sessions, requests)
- **Smooth stacked trend** — 7 / 30 / 90-day windows, fresh input / cache reads / cache writes /
  output per day as a hoverable stacked area chart
- **Compact ranges table** — today / last 7 days / last 30 days / this month as rows with cost,
  sessions and share bars
- **Agent donut, hourly & monthly histograms** — where your tokens and money go, by client,
  time of day and month
- **Ranked model bars** — models aggregated across agents with tokens, cost and share; the
  per-agent×model table remains as a collapsible detail
- **Top sessions table** — by tokens with duration, title, directory and cost

All filters (`--client`, `--since`, `--until`, `--today/--week/--month`) work for `web` too, and
the page offers a manual refresh, a 30s auto-refresh toggle, and a 中文 / EN language switch
(stored in `localStorage` as `toksight-locale`, default Chinese).

### Building the dashboard

The dashboard ships as prebuilt static files in `web/out/`:

```bash
npm run web:build        # once (cd web && npm install && npm run build)
toksight web             # serve it
```

Until `web/out/` is built, `toksight web` serves a setup-instructions page at `/` while
`/api/data` keeps working.

Options: `--port <n>` (default 4729), `--host <addr>` (default 127.0.0.1, loopback only),
`--no-open` (skip auto-opening the browser), `--api-only` (JSON API without the dashboard, used
for UI development — run it alongside `npm run web:dev` in `web/`).

### Cache hit rate

`cacheRead / (freshInput + cacheRead)` — the share of prompt tokens served from cache. Cache
*writes* are excluded (they are cold traffic being stored, not served).

## Privacy

toksight is local-first: it only **reads** session files on your machine and never sends your data
anywhere. The single network call is the anonymous LiteLLM pricing fetch; run `--offline` to
disable even that.

## JSON output

Every command accepts `--json` (e.g. `toksight daily --json`). Shape: `totals`, `cacheHitRate`,
`clients`, `models`, `daily`, `monthly`, `sessions`, `pricing` (incl. `unpricedModels`), `warnings`.

The web dashboard consumes the same payload (plus web-only extras such as `heatmap`, `trend`,
`trend7`, `trend90`, `hourly`, `today`, `last7Days`, `last30Days`, `thisMonth`, `activeDays`,
`streaks`, `peakDay`, `topSessions`, `longestSession`, `activityRange`, `timezone`) from
`GET /api/data` on its own origin.

## Development

```bash
npm test        # node:test suite with per-client fixtures (no network needed)
node bin/toksight.js   # run from source
npm run web:dev # develop the dashboard UI (needs `toksight web --api-only` running)
```

```
bin/toksight.js        executable entry
src/cli.js             arg parsing, commands, rendering
src/clients/           one parser per agent, normalized to a common entry shape
src/pricing.js         built-in table + LiteLLM cache + user overrides
src/aggregate.js       grouping/totals
src/webdata.js         web-dashboard aggregations (heatmap, trend, sessions…)
src/webserver.js       zero-dependency HTTP server for `toksight web`
src/format.js          ANSI tables & number formatting
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
