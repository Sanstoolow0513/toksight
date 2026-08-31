# AGENTS.md

## What this is

`toksight` — a Node.js CLI (zero runtime dependencies, ESM only, Node >= 20) that tracks token
usage, cost, and cache hit rate of AI coding agents by reading the local session files those
agents already write. Local-first: it only reads; the sole network call is the LiteLLM pricing
fetch (skippable with `--offline`). Phase 1 (stats) is done; phase 2 adds the `toksight web`
local dashboard (still no TUI).

## Commands

- `node --test` (or `npm test`) — run the node:test suite (34 tests); uses per-client fixtures, no
  network needed. Note: `node --test test/` with a directory arg fails with MODULE_NOT_FOUND on
  Node v24/Windows (the directory is treated as a module to load) — that's why the script passes
  no path; explicit file paths or a glob like `node --test "test/*.test.js"` also work.
- `node bin/toksight.js` (or `npm run smoke`) — run the CLI from source against real agent data.
- `npm run web:build` — build the dashboard's static export into `web/out/` (runs
  `npm install && npm run build` inside `web/`; needs network the first time). Required once
  before `toksight web` shows the UI; until then `/` serves a setup page while `/api/data` works.
- `npm run web:dev` — Next dev server for the dashboard; needs `node bin/toksight.js web
  --api-only` running (default port 4729, proxied via `TOKSIGHT_DEV_API` in `web/next.config.mjs`).
- No linter or typechecker is configured; plain JavaScript ESM throughout (no TypeScript).
- The **root CLI keeps zero runtime deps** (`package-lock.json` only records the root package);
  dashboard dependencies live solely in `web/package.json` and are build-time only.

## Architecture

```
bin/toksight.js     executable entry, calls src/cli.js main()
src/cli.js          arg parsing, commands, all rendering (text + --json); buildPayload feeds
                    both --json and the web API
src/clients/        one parser per agent, registered in src/clients/index.js
src/pricing.js      3-layer pricing: builtin table → LiteLLM (1h disk cache) → user overrides
src/aggregate.js    grouping/totals (summarize, byModel/Day/Month/Session, cacheHitRate)
src/webdata.js      web-dashboard aggregations over entries (heatmap, trend, hourly,
                    today/last7Days/thisMonth, topSessions, longestSession) — pure functions
src/webserver.js    zero-dep node:http server: static web/out + live /api/data
src/format.js       ANSI tables & number formatting
src/fsutils.js      walkFiles, streaming readJsonl, readJson, pathExists
web/                Next.js (App Router, JS, no Tailwind) dashboard, statically exported to
                    web/out and served by the CLI; app/page.js + components/ (Heatmap,
                    TrendChart, Donut, Bars, RangeTable, ModelBars, AgentHitRate) +
                    lib/format.js + lib/i18n.js (zh-CN / en, localStorage `toksight-locale`);
                    Vercel-style pure-black theme (design-spec.md v2), Geist fonts +
                    lucide-react icons (build-time deps in web/package.json)
```

Each client parser exports `id`, `label`, `sourceRoots({ env, home })`, and
`collect({ env, home, roots })` returning `{ entries, warnings }`. New clients must be added to
the `clients` map and `clientAliases` in `src/clients/index.js`, get a fixture under
`test/fixtures/<client>/`, a test in `test/clients.test.js`, and README table updates.

### Normalized entry shape (the core contract)

Every parser emits records with exactly: `client, sessionId, model, timestamp` (ms epoch or
`null`), `inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens`,
`costUsd` (see below), `directory, title`. Cost is computed centrally in `cli.js`
(`collectAll` → `computeCost`) — parsers leave `costUsd: null` unless the agent itself reports
cost (only OpenCode does).

## Gotchas & rules

- **ZCode double-count guard**: the SQLite db (`~/.zcode/cli/db/db.sqlite`, `model_usage` table)
  is the source of truth; `~/.zcode/cli/rollout/*.jsonl` is a fallback used only when the db
  cannot be read. Never collect from both. `node:sqlite` needs Node >= 22.5; on older Node the
  db test skips and parsing falls back to rollout.
- **Parsers must never throw** on bad data: tolerate malformed/unreadable files, push messages
  into `warnings`, skip empty-usage rows. `cli.js` collects clients via `Promise.allSettled` and
  prints warnings on stderr (they also appear under `warnings` in JSON output).
- **Dedup/diff semantics per client**: Claude dedupes message ids; Codex prefers `last_token_usage`
  and diffs cumulative totals; Gemini splits cached prompt tokens and adds thoughts to output;
  Kimi counts every `usage.record` as-is (per-request, never cumulative; both `turn` and
  `session` usageScope records are real spend).
  Preserve these when editing parsers — tests pin them.
- **Env injection**: parsers take `{ env, home }` params instead of reading `process.env`
  directly, so tests can point them at fixtures (e.g. `ZCODE_HOME`, `CLAUDE_CONFIG_DIR`,
  `CODEX_HOME`, `OPENCODE_PATH`, `GEMINI_CLI_HOME`, `KIMI_CODE_HOME`).
- **`--json` output is a user-facing contract**: shape is `totals, cacheHitRate, clients, models,
  daily, monthly, sessions, pricing (incl. unpricedModels), warnings` — don't break it. The web
  API (`GET /api/data`) reuses this exact payload (via `buildPayload`) and layers the
  `src/webdata.js` extras on top (`heatmap, trend, hourly, today, last7Days, thisMonth,
  topSessions, longestSession, activityRange, timezone`); the extras are additive and must stay
  backwards compatible too. Each `clients` entry is that agent's totals plus its own
  `cacheHitRate`, built via `agg.byClient` from the **filtered** entries, so `--client` /
  `--since` / `--until` apply to it like every other slice (pinned by `test/payload.test.js`).
- **Local timezone**: day grouping and `--since`/`--until` use the machine's local time, not UTC.
- **Cache hit rate** = `cacheRead / (freshInput + cacheRead)`; cache *writes* are excluded
  (they're cold traffic being stored, not served). Attributed **per request** — each entry carries
  its own model and token split, so a session that switched models splits cleanly across the
  per-agent / per-model views (a model's cache can only hit for that same model).
- **Zero runtime dependencies**: do not add packages to the root CLI; use `node:` builtins.
  `web/` is the only place allowed to have dependencies (Next/React, build-time only).
- **Web serving rules**: `toksight web` re-collects on every request (fresh data, no caching);
  binds 127.0.0.1 by default (never 0.0.0.0 by default); static assets under `web/out/_next/`
  are immutable-cached, everything else `no-cache`; path traversal is rejected (403); if
  `web/out/index.html` is missing, `/` serves the built-in setup page instead of failing.
- Windows compatibility matters (paths, fixtures use `C:\\...` directories); `pathExists`
  handles `ENOTDIR` for files.

## Docs

`README.md` and `README.zh-CN.md` are bilingual mirrors — update both when changing CLI options,
data sources, pricing behavior, the web dashboard, or the JSON shape. `design-spec.md` is the
locked visual spec for the dashboard. `pricing.json` user
overrides match model names exactly or by `provider/`-suffix (e.g. `zhipuai/glm-5.3` covers
`GLM-5.3`). `web/AGENTS.md` is generated by Next.js tooling — keep it when committing.

## Researched but not implemented

- **Cursor (2026-08, decided against for now)**: sessions/models/timestamps ARE readable, token
  usage is NOT reliably written locally. Sources inspected on a real machine: per-chat
  `~/.cursor/chats/<workspaceHash>/<sessionId>/meta.json` (title, `createdAtMs`, `updatedAtMs`,
  `cwd`) and `store.db` (SQLite; `meta` table value is hex-encoded JSON with `lastUsedModel`,
  `createdAt`; `blobs` table holds full conversation messages as decimal-CSV byte strings, some
  encrypted via `blobEncryptionKey`); `%APPDATA%/Cursor/User/globalStorage/state.vscdb` has a
  `composerHeaders` table plus `cursorDiskKV` keys `composerData:<id>` (`modelConfig.modelName`)
  and `bubbleId:<composerId>:<bubbleId>`. Bubbles carry a `tokenCount {inputTokens, outputTokens}`
  field but it was all-zero across 349 bubbles (subscription/privacy-mode dependent);
  `composerData.usageData` was empty; `~/.cursor/ai-tracking/ai-code-tracking.db` tracks AI-authored
  code *lines*, not tokens. Real usage lives server-side (dashboard API, needs login → violates
  local-first). A future parser could emit sessions/models/message counts and use `tokenCount`
  when non-zero, but cost/token stats would be mostly empty — revisit if Cursor starts writing
  token counts again.
