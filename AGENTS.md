# AGENTS.md

## What this is

`toksight` — a Node.js CLI (zero runtime dependencies, ESM only, Node >= 20) that tracks token
usage, cost, and cache hit rate of AI coding agents by reading the local session files those
agents already write. Local-first: statistics only read; the explicit web config import is the
sole write path and backs up existing targets first. The sole network call is the LiteLLM pricing
fetch (skippable with `--offline`). Phase 1 (stats) is done; phase 2 adds the `toksight web`
local dashboard and fixed-scope agent configuration transfer (still no TUI).

## Commands

- `node --test` (or `npm test`) — run the node:test suite (90 tests); uses per-client fixtures, no
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
src/cli.js          command dispatch only: parse → help/version → web (runWeb single-flight
                    getData) → collect → render; no collection or rendering lives here
src/args.js         parseArgs (value options accept `--flag value` AND `--flag=value`;
                    `now` injectable for deterministic window tests)
src/collect.js      collectAll — the collection pipeline shared by the CLI, --json and the
                    web API (pricing + clients + filters, env/home threaded for tests);
                    perClient rows carry { id, label, roots, entries } so renderers never
                    re-ask the client registry or use process defaults
src/render.js       all text rendering: renderCommand (per-command pages incl. env),
                    renderJson, tables, totals section, warnings, empty-state page
                    (prints the perClient roots actually scanned)
src/payload.js      buildPayload — the user-facing --json contract (feeds both --json and the
                    web API); presentation-free data layer
src/dates.js        the ONLY home for local-time date arithmetic (startOfDay/endOfDay/stepDay/
                    startOfMonth/eachDay/dayKeyToTs/parseDateArg). endOfDay/--week/every day
                    loop step local midnights — DST-safe, never blind `+24h`; do not
                    re-implement these elsewhere
src/clients/        one parser per agent, registered in src/clients/index.js; shared
                    src/clients/sqlite.js openSqliteReadOnly() centralizes the
                    dynamic node:sqlite import + readOnly open for the db-first guards
src/pricing.js      3-layer pricing: builtin table → LiteLLM (1h disk cache) → user overrides;
                    lookup maps are { exact, suffix } — suffix pre-indexes provider-prefixed
                    keys by bare name (O(1), not a per-miss scan of the LiteLLM table)
src/aggregate.js    grouping/totals (summarize, byModel/Day/Month/Session, cacheHitRate)
src/webdata.js      web-dashboard aggregations over entries (heatmap, trend, trendByAgent,
                    hourly, today/last7Days/thisMonth, sessions w/ activeMs, longestSession)
                    — pure functions; day math imported from src/dates.js
src/agentconfigs.js fixed five-agent user-config allowlist; redacted inventory, checksummed
                    export bundles, selective transactional import with timestamped backups
src/webserver.js    zero-dep node:http server: static web/out + live /api/data and loopback-only
                    /api/config preview/export/import endpoints
src/format.js       ANSI tables & number formatting
src/fsutils.js      walkFiles (returns { files, warnings }: root ENOENT is silent, other read
                    failures warn), streaming readJsonl, readJson, pathExists
web/                Next.js (App Router, JS, no Tailwind) dashboard + app/config/page.js,
                    statically exported to web/out and served by the CLI; app/page.js +
                    components/ (Heatmap,
                    TrendChart with mix/agent step-after stacks, AgentsPanel, ModelBars with
                    hard-split cache bars, Bars; every chart tooltip is the shared components/Tip)
                    + lib/format.js + lib/i18n.js (zh-CN / en,
                    localStorage `toksight-locale`) + lib/palette.js; fluid layout + motion
                    rules (design-spec.md v6 is the construction spec;
                    design-system/toksight/MASTER.md is a projection of it — do not ship
                    raw ui-ux-pro-max --persist output), Brutalism phosphor worksheet
                    (bg #060609, panel #0e0e15, 2px mosaic in --color-border-strong,
                    lime #c9f24b, radius 0), Geist fonts + lucide-react icons (build-time
                    deps in web/package.json). v6 layout: masthead → 4-cell KPI strip →
                    12-col .sheet (trend, heatmap, agent/model, hour/month/pace, sessions
                    table). Kept from v4: icons only for actions/states (RefreshCw,
                    ChevronDown, FileUp, Download, success/warn/empty/error), no entrance choreography, no ambient
                    glow, no "live" badge (nav shows last-fetch time from generatedAt),
                    categorical palette is brand-lime + slate-gray rank ramp (colorAt
                    encodes rank, not identity).
```

Each client parser exports `id`, `label`, `sourceRoots({ env, home })`, and
`collect({ env, home, roots })` returning `{ entries, warnings }`. New clients must be added to
the `clients` map and `clientAliases` in `src/clients/index.js`, get a fixture under
`test/fixtures/<client>/`, a test in `test/clients.test.js`, and README table updates.

### Normalized entry shape (the core contract)

Every parser emits records with exactly: `client, sessionId, model, timestamp` (ms epoch or
`null`), `inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens`,
`costUsd` (see below), `directory, title`. Cost is computed centrally in `src/collect.js`
(`collectAll` → `computeCost`) — parsers leave `costUsd: null` unless the agent itself reports
cost (only OpenCode does).

## Gotchas & rules

- **OpenCode db-first guard**: v1.2+ `~/.local/share/opencode/opencode.db` (`message` table, JSON
  `data` column, LEFT JOIN `session` for directory/title) is the source of truth;
  `<base>/storage/message/*.json` (v1.1.x layout) is a fallback used only when the db is absent
  (silently — the agent never wrote one) or cannot be read (warning). Never collect from both.
  SQLite-era rows hardcode `cost: 0` as a placeholder — only
  non-zero self-reported costs are honored there (legacy JSON costs are honored as-is).
- **ZCode double-count guard**: the SQLite db (`~/.zcode/cli/db/db.sqlite`, `model_usage` table)
  is the source of truth; `~/.zcode/cli/rollout/*.jsonl` is a fallback used only when the db is
  absent (silently) or cannot be read (warning). Never collect from both. `node:sqlite` needs
  Node >= 22.5; on older Node the
  db test skips and parsing falls back to rollout. ZCode's `input_tokens` counts the whole prompt
  **with cache reads included** (rollout `totalTokens = input + output + cacheWrite` proves
  writes stay separate), so both paths subtract `cacheRead` to emit fresh input — without this,
  the hit-rate denominator and `computeCost` double-count cached tokens.
- **Parsers must never throw** on bad data: tolerate malformed/unreadable files, push messages
  into `warnings`, skip empty-usage rows. `src/collect.js` collects clients via
  `Promise.allSettled` and
  prints warnings on stderr (they also appear under `warnings` in JSON output). Warnings also
  cover read failures that are NOT a plain missing root (`walkFiles` ENOENT on a root is silent —
  not every agent is installed; EACCES/ENOTDIR etc. warn), kimi `state.json` that exists but
  cannot be read/parsed, and entries without a timestamp (null OR non-finite — parsers
  normalize NaN to null) excluded by `--since`/`--until`
  (reported instead of silently vanishing).
- **Claude dedup is max-wins**: assistant lines can repeat a message id with a *growing* usage
  snapshot (streaming partial → final). Keep the snapshot with the largest token total, not the
  first line (first-wins undercounts).
- **Dedup/diff semantics per client**: Claude dedupes message ids (max-wins, see above); Codex
  prefers `last_token_usage`
  and diffs cumulative totals;
  Kimi counts every `usage.record` as-is (per-request, never cumulative; both `turn` and
  `session` usageScope records are real spend).
  Preserve these when editing parsers — tests pin them.
- **Env injection**: parsers take `{ env, home }` params instead of reading `process.env`
  directly, so tests can point them at fixtures (e.g. `ZCODE_HOME`, `CLAUDE_CONFIG_DIR`,
  `CODEX_HOME`, `OPENCODE_PATH`, `KIMI_CODE_HOME`). `collectAll(opts, { env, home })` threads
  the same injection through the whole pipeline (pricing config included), pinned by
  `test/cli.test.js`.
- **`--json` output is a user-facing contract**: shape is `totals, cacheHitRate, clients, models,
  daily, monthly, sessions, pricing (incl. unpricedModels), warnings` — don't break it.
  `buildPayload` lives in `src/payload.js`. The web
  API (`GET /api/data`) reuses this exact payload (via `buildPayload`) and layers the
  `src/webdata.js` extras on top (`heatmap, trend, trendByAgent, hourly, today, last7Days,
  thisMonth, topSessions, longestSession (ranked by activeMs — idle gaps capped at 5min),
  activityRange, timezone`); the extras are additive and must stay
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
- **Web serving rules**: `toksight web` re-collects on every request (fresh data, no caching —
  the single-flight in `runWeb` only dedupes CONCURRENT requests onto one collection run, no
  TTL); binds 127.0.0.1 by default (never 0.0.0.0 by default); static assets under `web/out/_next/`
  are immutable-cached, everything else `no-cache`; path traversal is rejected (403); if
  `web/out/index.html` is missing, `/` serves the built-in setup page instead of failing.
- **Config transfer scope/safety**: only user-level configuration for ZCode, Claude Code, Codex
  CLI, OpenCode and Kimi Code is allowlisted in `src/agentconfigs.js`; never add project/managed
  policy, `.env`, session/history or auth/credential stores implicitly. Inventory and imported
  package previews are redacted, but exports intentionally preserve exact file contents and can
  contain secrets. Bundle paths are never trusted: destinations come only from the allowlist and
  injected env/home. Selective import prepares same-directory temp files, renames each existing
  target to `.backup-<UTC timestamp>`, applies all items, and attempts a full rollback on failure.
  Config APIs require loopback clients, JSON POSTs and same-origin/no-CORS access even when the
  statistics server is bound more broadly.
- Windows compatibility matters (paths, fixtures use `C:\\...` directories); `pathExists`
  handles `ENOTDIR` for files.

## Docs

`README.md` and `README.zh-CN.md` are bilingual mirrors — update both when changing CLI options,
data sources, pricing behavior, the web dashboard, or the JSON shape. `design-spec.md` is the
locked visual spec for the dashboard. `pricing.json` user
overrides match model names exactly or by `provider/`-suffix (e.g. `zhipuai/glm-5.3` covers
`GLM-5.3`). `web/AGENTS.md` is generated by Next.js tooling — keep it when committing.

## Researched but not implemented

- **Second pricing source for cache prices (2026-09, TODO)**: LiteLLM entries often lack
  `cache_read_input_token_cost` / `cache_creation_input_token_cost`, and toksight currently
  falls back to the input price — a deliberate conservative overestimate (documented in both
  READMEs). Best candidate to fill the gap: **models.dev** (`https://models.dev/api.json`;
  open-source, community-maintained by the SST/opencode folks, TOML in-repo so gaps can be
  PR'd). Its schema has optional `cost.cache_read` / `cost.cache_write` in USD/MTok — same unit
  as toksight's builtin table — so it could slot in as a cross-check source beside LiteLLM.
  Runner-up: OpenRouter `/api/v1/models` (has cache pricing) — but its numbers are router prices
  including margin, so only a fallback. Users can already maintain their own prices via
  `pricing.json` (exact names or `provider/`-suffix matching). Decision at the time: keep the
  input-price fallback, do the research, revisit later.
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
- **Cursor re-check (2026-09-02, BYOK question — still no)**: re-verified on the new agent storage
  architecture and probed the server APIs live. New layout: per-session
  `~/.cursor/chats/<hash>/<sessionId>/store.db` (tables `blobs(id, data)` = decimal-CSV byte
  strings holding `{role, content[], id, providerOptions.cursor.modelProviderMessageId}` — no
  usage/token fields on assistant messages) + `meta` (hex JSON: agentId, name, createdAt,
  subagentInfo); state.vscdb grew a `composerHeaders` table (78 rows, migration flag
  `composer.composerHeaders.migratedToTable`) and 9648 `agentKv:blob:<sha>` content-addressed
  entries; bubbles moved there but `tokenCount` is still all-zero (4597/4597); `composerData`
  now also has `contextTokensUsed`/`promptTokenBreakdown` (last-prompt size only, not billing).
  BYOK: official docs confirm every BYOK request routes through Cursor's backend (key sent
  per-request, never stored server-side) and BYOK usage is "unlimited, at your own cost" — it
  does not count against plan quotas and is not itemized in the dashboard's Spending/Usage
  (plan spend only). Server-side probes: `GET api2.cursor.sh/auth/usage` works with the
  plaintext JWT from ItemTable `cursorAuth/accessToken` but returns quota request counts only
  (all zeros on an Ultra account, no BYOK, no token detail); `cursor.com/api/usage` requires
  the browser `WorkosCursorSessionToken` cookie (401 with JWT); the official Analytics API
  (`api.cursor.com/analytics/*`, API-key auth) is Enterprise-teams-only. The authoritative
  BYOK token/cost data lives at the provider (OpenAI admin Usage API
  `/v1/organization/usage/completions` / Anthropic equivalents): day×model aggregates with
  cached-token detail, but no session/project attribution — a poor fit for the per-request
  entries contract and a local-first violation (network + provider admin keys). Machine
  details noted: BYOK OpenAI key present as encrypted ItemTable `secret://cursorAuth/openAIKey`;
  hash-like model names in `modelConfig.modelName` (e.g. `9d20c7907fd2663c`) are Cursor's
  anonymized model IDs, not necessarily BYOK markers.
