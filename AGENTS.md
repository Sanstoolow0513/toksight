# AGENTS.md

## What this is

`toksight` — a Node.js CLI (zero runtime dependencies, ESM only, Node >= 20) that tracks token
usage, cost, and cache hit rate of AI coding agents by reading the local session files those
agents already write. Local-first: it only reads; the sole network call is the LiteLLM pricing
fetch (skippable with `--offline`). Phase 1 is stats only — no TUI.

## Commands

- `node --test` (or `npm test`) — run the node:test suite (12 tests); uses per-client fixtures, no
  network needed. Note: `node --test test/` with a directory arg fails with MODULE_NOT_FOUND on
  Node v24/Windows (the directory is treated as a module to load) — that's why the script passes
  no path; explicit file paths or a glob like `node --test "test/*.test.js"` also work.
- `node bin/toksight.js` (or `npm run smoke`) — run the CLI from source against real agent data.
- No linter or typechecker is configured; plain JavaScript ESM throughout (no TypeScript).
- No dependencies to install — the repo has zero runtime deps (`package-lock.json` only records
  the root package).

## Architecture

```
bin/toksight.js     executable entry, calls src/cli.js main()
src/cli.js          arg parsing, commands, all rendering (text + --json)
src/clients/        one parser per agent, registered in src/clients/index.js
src/pricing.js      3-layer pricing: builtin table → LiteLLM (1h disk cache) → user overrides
src/aggregate.js    grouping/totals (summarize, byModel/Day/Month/Session, cacheHitRate)
src/format.js       ANSI tables & number formatting
src/fsutils.js      walkFiles, streaming readJsonl, readJson, pathExists
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
  and diffs cumulative totals; Gemini splits cached prompt tokens and adds thoughts to output.
  Preserve these when editing parsers — tests pin them.
- **Env injection**: parsers take `{ env, home }` params instead of reading `process.env`
  directly, so tests can point them at fixtures (e.g. `ZCODE_HOME`, `CLAUDE_CONFIG_DIR`,
  `CODEX_HOME`, `OPENCODE_PATH`, `GEMINI_CLI_HOME`).
- **`--json` output is a user-facing contract**: shape is `totals, cacheHitRate, clients, models,
  daily, monthly, sessions, pricing (incl. unpricedModels), warnings` — don't break it.
- **Local timezone**: day grouping and `--since`/`--until` use the machine's local time, not UTC.
- **Cache hit rate** = `cacheRead / (freshInput + cacheRead)`; cache *writes* are excluded
  (they're cold traffic being stored, not served).
- **Zero runtime dependencies**: do not add packages; use `node:` builtins.
- Windows compatibility matters (paths, fixtures use `C:\\...` directories); `pathExists`
  handles `ENOTDIR` for files.

## Docs

`README.md` and `README.zh-CN.md` are bilingual mirrors — update both when changing CLI options,
data sources, pricing behavior, or the JSON shape. `pricing.json` user overrides match model
names exactly or by `provider/`-suffix (e.g. `zhipuai/glm-5.3` covers `GLM-5.3`).

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
