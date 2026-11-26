# 🔭 toksight

[简体中文](./README.zh-CN.md) · [Install](#install) · [Usage](#usage) · [Web dashboard](#web-dashboard)

Track token usage, estimated cost and prompt cache hit rate across your AI coding agents. Use the CLI for a quick total, or open the local dashboard to see which agents, models and sessions account for it.

## Supported agents

Claude Code, Codex CLI, Gemini CLI, Antigravity CLI, Kimi Code, OpenCode and ZCode. Use `toksight env` to see where toksight looks for their history.

<details>
<summary>Agent IDs, history locations and directory overrides</summary>

| Agent (filter ID) | Default usage source | Directory override |
| --- | --- | --- |
| Claude Code (`claude`) | `~/.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR` |
| Codex CLI (`codex`) | `~/.codex/sessions/` and `~/.codex/archived_sessions/` (`.jsonl`, `.jsonl.zst`) | `CODEX_HOME` |
| Gemini CLI (`gemini`) | `~/.gemini/tmp/<project>/chats/`; on macOS also `~/.cache/.gemini/tmp/<project>/chats/` | `GEMINI_CLI_HOME` (base for both paths) |
| Antigravity CLI (`antigravity` or `agy`) | `~/.gemini/antigravity-cli/brain/<session>/.system_generated/logs/` | `ANTIGRAVITY_CLI_DIR` |
| Kimi Code (`kimi`) | `~/.kimi-code/sessions/**/agents/*/wire.jsonl` | `KIMI_CODE_HOME` |
| OpenCode (`opencode`) | `~/.local/share/opencode/opencode.db`, with a fallback to `storage/message/` | `OPENCODE_PATH` |
| ZCode (`zcode`) | `~/.zcode/cli/db/db.sqlite`, with a fallback to `cli/rollout/` | `ZCODE_HOME` |

</details>

Gemini CLI and Antigravity CLI support landed after npm v1.4.0. To try them from a `dev` checkout, run `node bin/toksight.js --client gemini,agy`.

## Install

Requires Node.js 22.15+ in the 22.x series, or 23.8 and later.

```bash
npx toksight             # Run once
npm install -g toksight  # Install globally
```

## Usage

```bash
toksight                           # Totals, usage by agent and top models
toksight daily --week              # Daily totals for the last seven days
toksight monthly --client codex    # Monthly totals for one agent
toksight models --today            # Today's usage by model
toksight sessions --month --top 5  # Five costliest sessions this month
```

Use `--client claude,codex` to combine agents. For a specific period, pass `--since YYYY-MM-DD` and `--until YYYY-MM-DD`. Both dates are inclusive and use your local timezone. Run `toksight --help` for all commands and options.

## Pricing

Reports use charges recorded by the agent when available. Other requests use your model prices or first-party API rates from LiteLLM. Models without a price still contribute to token totals. Reference costs can differ from your subscription bill.

Use **Update prices** on the dashboard's **Prices** page, or pass `--offline` to use saved rates. For a custom rate, create `~/.config/toksight/pricing.json` with prices in **USD per million tokens**:

```json
{ "my-model": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 } }
```

If you use `XDG_CONFIG_HOME`, the file is under `$XDG_CONFIG_HOME/toksight/`. Set `TOKSIGHT_CONFIG_DIR` to override the directory. [Custom provider configuration](https://github.com/Sanstoolow0513/toksight/blob/release/doc/local-pricing.md)

## Web dashboard

Run `toksight web --open` to open the report at `http://127.0.0.1:4729`.

| To… | Use |
| --- | --- |
| See today's activity | **Today** shows tokens, cost, cache hit rate and sessions. Expand an agent to see its models. |
| Explore another period | **Calendar** loads daily totals and selection details independently. Select a day or drag across a range to see its totals and sessions. |
| Share a report | **Export image** saves the current Today or Calendar view as a PNG. |
| Pick up new sessions | Click **Refresh** or run `toksight refresh`. Change the reporting timezone in **Settings**. |

Cache hit rate is the share of prompt tokens served from cache: `cache read / (fresh input + cache read)`.

### Backups

In **Settings**, export or import a complete SQLite backup, or use the CLI:

```bash
toksight refresh                  # Include the latest sessions
toksight export-db backup.sqlite  # Write a new backup file
toksight import-db backup.sqlite  # Merge the backup into local history
```

Backups cover all dates and agents. Import keeps local usage and deduplicates matching records. For manual backup and restore using a private GitHub repository, see [GitHub backup setup](https://github.com/Sanstoolow0513/toksight/blob/release/doc/github-backup.md).

## Privacy

Agent files are read-only. Reports stay on your machine by default. `--offline` disables price downloads. Backups include session titles and directories, so share them only if you want to share those details.

## JSON output

Run `toksight daily --week --json` to get totals, breakdowns by agent, model, day and session, plus pricing coverage and collection warnings. [JSON field reference](https://github.com/Sanstoolow0513/toksight/blob/release/doc/data-contract.md)

## Development

Target `dev` for development PRs and `release` for releases. Run `npm test` for the offline suite. For dashboard changes, run `npm run web:ci` followed by `npm run web:dev` and open `http://127.0.0.1:3000`. Use `npm run check:package` to verify the installable package. [Project conventions](https://github.com/Sanstoolow0513/toksight/blob/release/AGENTS.md) · [Development and release guide](https://github.com/Sanstoolow0513/toksight/blob/release/doc/development-release.md)

## License

[MIT](./LICENSE). Independent of the agent vendors. Inspired by [tokscale](https://github.com/junhoyeo/tokscale) and [ccusage](https://github.com/ccusage/ccusage). Provider logos are from [LobeHub Icons](https://github.com/lobehub/lobe-icons) ([license](https://github.com/Sanstoolow0513/toksight/blob/release/frontend/public/logos/LICENSE.txt)).
