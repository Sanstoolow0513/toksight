# Agent 采集器

## 接入合同

每个 `src/clients/<id>.js` 导出 `id`、`label`、`sourceRoots({ env, home })`、`collect({ env, home, roots })`，最后一个返回 `{ entries, warnings }`。注册到 `src/clients/index.js` 的 `clients` 和 `clientAliases`；增加 `test/fixtures/<id>/`、`test/clients.test.js` 用例，并更新两个 README 的支持列表。记录字段与费用归属见[数据契约](data-contract.md)。

解析器通过参数获取 `env` 和 `home`，不要在解析过程中直接取 `process.env`。`collectAll` 把同一注入传给根路径、解析器和定价配置，测试可用 `ZCODE_HOME`、`CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`OPENCODE_PATH`、`KIMI_CODE_HOME` 指向 fixture。

## 各来源的计数口径

| 客户端 | 主要来源 | 避免重复/错算的规则 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | 同一 message ID 可能有递增的 streaming 用量快照；按 token 总数保留最大一条 |
| Codex | `~/.codex/sessions/` 和 `~/.codex/archived_sessions/` 下的 `.jsonl`、`.jsonl.zst` | 优先用 `last_token_usage`，否则对累计 `total_token_usage` 做差；`cached_input_tokens` 从总输入中扣出 |
| Kimi Code | `~/.kimi-code/sessions/**/agents/*/wire.jsonl` | 每条 `usage.record` 都是真实请求，`turn` 与 `session` scope 都计入；`state.json` 给会话元数据 |
| OpenCode | `<base>/opencode.db`：新版 `session_message`（`type = 'assistant'`，联结 `session_v2`），旧版 `message`（联结 `session`） | 新、旧消息表在同一只读事务中采集；同一 ID 优先计入新表的有效用量，遇到空用量或坏行时可采用旧表记录；DB 存在且可读时只用 DB；缺失或打不开才退到 `storage/message/*.json`，绝不合算两处。DB 中 `cost: 0` 是占位，只有非零自报费用可信；旧 JSON 的数值费用照录 |
| ZCode | `~/.zcode/cli/db/db.sqlite` 的 `model_usage`，联结 `session` | DB 优先，缺失或打不开才退到 `cli/rollout/*.jsonl`；两种来源的 `input_tokens` 都包含 cache read，需扣掉后作为新鲜输入 |

OpenCode 的消息表查询失败时报告警告，并继续采集同一数据库中其他可读的消息表。两种表均缺失时报告警告。ZCode 无法查询数据库用量表时也会报告警告。两者仅在数据库缺失或无法打开时读取旧文件。

Codex 流式解压归档。归档损坏时丢弃该文件的全部用量，并在警告中给出路径。标准 rollout 文件名中的线程 UUID 决定会话归属，旧式文件名依次回退到首个有效的 `session_meta.id` 和去掉格式后缀的文件名。模型随 `turn_context` 更新。同一线程的多个分段按事件时间合并，跨文件用时间戳和两份用量快照匹配重叠事件，每个事件保留单个文件中的最大出现次数。

## 容错与过滤

可选提供商信息和 Claude 1h 缓存写入子集见[本机价格库](local-pricing.md#提供商映射)。
这些元数据不参与去重身份，也不改变五类 token 数的原有含义。

坏文件/坏行应跳过或给 warning，解析器不因单个来源损坏而抛出；空用量行跳过。`collectAll` 用 `Promise.allSettled` 隔离各客户端异常。根目录不存在时 `walkFiles` 静默，其他读取失败（如 `EACCES`、`ENOTDIR`）报警；存在但不可读或不可解析的 Kimi `state.json` 也报警。

时间戳统一为毫秒 epoch 或 `null`，非法 `Date.parse` 结果不可保留为 `NaN`。`--since` / `--until` 排除无可用时间戳的记录时要在 `warnings` 说明；warning 在 CLI stderr 与 JSON `warnings` 中可见。Windows 路径也要用 fixture 验证，`pathExists` 将文件路径中的 `ENOTDIR` 当作不存在处理。
