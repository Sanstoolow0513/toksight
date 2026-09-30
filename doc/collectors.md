# Agent 采集器

## 接入合同

每个 `src/clients/<id>.js` 导出 `id`、`label`、`sourceRoots({ env, home })`、`collect({ env, home, roots })`，最后一个返回 `{ entries, warnings }`。注册到 `src/clients/index.js` 的 `clients` 和 `clientAliases`；增加 `test/fixtures/<id>/`、`test/clients.test.js` 用例，并更新两个 README 的支持列表。记录字段与费用归属见[数据契约](data-contract.md)。

解析器通过参数获取 `env` 和 `home`，不要在解析过程中直接取 `process.env`。`collectAll` 把同一注入传给根路径、解析器和定价配置，测试可用 `ZCODE_HOME`、`CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`OPENCODE_PATH`、`KIMI_CODE_HOME` 指向 fixture。

## 各来源的计数口径

| 客户端 | 主要来源 | 避免重复/错算的规则 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | 同一 message ID 可能有递增的 streaming 用量快照；按 token 总数保留最大一条 |
| Codex | `~/.codex/sessions/**/*.jsonl` | 优先用 `last_token_usage`，否则对累计 `total_token_usage` 做差；`cached_input_tokens` 从总输入中扣出 |
| Kimi Code | `~/.kimi-code/sessions/**/agents/*/wire.jsonl` | 每条 `usage.record` 都是真实请求，`turn` 与 `session` scope 都计入；`state.json` 给会话元数据 |
| OpenCode | `<base>/opencode.db` 的 `message`，联结 `session` | DB 存在且可读时只用 DB；缺失或打不开才退到 `storage/message/*.json`，绝不合算两处。DB 中 `cost: 0` 是占位，只有非零自报费用可信；旧 JSON 的数值费用照录 |
| ZCode | `~/.zcode/cli/db/db.sqlite` 的 `model_usage`，联结 `session` | DB 优先，缺失或打不开才退到 `cli/rollout/*.jsonl`；两种来源的 `input_tokens` 都包含 cache read，需扣掉后作为新鲜输入 |
| Cursor | toksight SQLite 中的 `cursor_imports` | 从 Usage Events CSV 导入；没有 session ID，因此不产生会话明细/计数 |

OpenCode 和 ZCode 的“数据库存在但表不可查询”会给 warning；当前代码在这种情况下返回空结果，不再读取旧格式。调整回退条件时应同时核对这些解析器测试。

## 容错与过滤

坏文件/坏行应跳过或给 warning，解析器不因单个来源损坏而抛出；空用量行跳过。`collectAll` 用 `Promise.allSettled` 隔离各客户端异常。根目录不存在时 `walkFiles` 静默，其他读取失败（如 `EACCES`、`ENOTDIR`）报警；存在但不可读或不可解析的 Kimi `state.json` 也报警。

时间戳统一为毫秒 epoch 或 `null`，非法 `Date.parse` 结果不可保留为 `NaN`。`--since` / `--until` 排除无可用时间戳的记录时要在 `warnings` 说明；warning 在 CLI stderr 与 JSON `warnings` 中可见。Windows 路径也要用 fixture 验证，`pathExists` 将文件路径中的 `ENOTDIR` 当作不存在处理。
