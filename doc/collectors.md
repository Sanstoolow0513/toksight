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
| OpenCode | `<base>/opencode.db`：新版 `session_message`（`type = 'assistant'`，联结 `session_v2`），旧版 `message`（联结 `session`） | 两种表都读，同一 message id 只计一次（新表优先）；DB 存在且可读时只用 DB；缺失或打不开才退到 `storage/message/*.json`，绝不合算两处。DB 中 `cost: 0` 是占位，只有非零自报费用可信；旧 JSON 的数值费用照录 |
| ZCode | `~/.zcode/cli/db/db.sqlite` 的 `model_usage`，联结 `session` | DB 优先，缺失或打不开才退到 `cli/rollout/*.jsonl`；两种来源的 `input_tokens` 都包含 cache read，需扣掉后作为新鲜输入 |

## 请求耗时

解析器用 `src/tps.js` 的 `durationFields` 写入可选 `durationMs` / `durationSource`；≤ 0 或无法解析的耗时不写。

| 客户端 | 来源 | 方式 |
| --- | --- | --- |
| OpenCode | `time.created` → `time.completed` | measured |
| ZCode | DB `started_at` → `completed_at`；rollout `startedAt` → `completedAt` | measured |
| Kimi Code | 同一 wire.jsonl 中最近一条同模型 `llm.request.time` → `usage.record.time`；更早未配对的请求视为重试并丢弃 | measured |
| Claude Code | 首条 assistant 行经 `parentUuid` 指向的 `user` 行（提示或 tool_result）→ 该 message id 的最后一行；父行缺失或不是 user 时不写 | inferred |
| Codex | 第一个输出项（reasoning / assistant message / 工具调用）之前最近的输入项（user / developer 消息、工具输出、上一用量标记）→ 首个用量标记（新版 `token_usage_record`，否则 `token_count`）；输出被新输入打断而无用量标记（中止、回放历史）或配对不明确时不写 | inferred |

OpenCode 数据库两种消息表都没有、ZCode 的 `model_usage` 不可查询时会给 warning；当前代码在这种情况下返回空结果，不再读取旧格式。调整回退条件时应同时核对这些解析器测试。

## 容错与过滤

可选提供商信息和 Claude 1h 缓存写入子集见[本机价格库](local-pricing.md#提供商映射)。
这些元数据不参与去重身份，也不改变五类 token 数的原有含义。

坏文件/坏行应跳过或给 warning，解析器不因单个来源损坏而抛出；空用量行跳过。`collectAll` 用 `Promise.allSettled` 隔离各客户端异常。根目录不存在时 `walkFiles` 静默，其他读取失败（如 `EACCES`、`ENOTDIR`）报警；存在但不可读或不可解析的 Kimi `state.json` 也报警。

时间戳统一为毫秒 epoch 或 `null`，非法 `Date.parse` 结果不可保留为 `NaN`。`--since` / `--until` 排除无可用时间戳的记录时要在 `warnings` 说明；warning 在 CLI stderr 与 JSON `warnings` 中可见。Windows 路径也要用 fixture 验证，`pathExists` 将文件路径中的 `ENOTDIR` 当作不存在处理。
