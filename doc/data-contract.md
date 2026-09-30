# 数据契约与时间口径

## 标准记录

每个解析器的记录具有以下必需字段；`src/dbtransfer.js` 也按这些字段验证导入：

| 字段 | 含义 |
| --- | --- |
| `client`, `sessionId`, `model` | 客户端 ID、可空会话 ID、原始模型名 |
| `timestamp` | 毫秒 epoch 或 `null`；无效时间不可用 `NaN` 表示 |
| `inputTokens`, `outputTokens`, `reasoningTokens` | 新鲜输入、输出、输出中的推理 token |
| `cacheReadTokens`, `cacheWriteTokens` | 本次请求的缓存读取、写入 |
| `costUsd` | 美元费用或 `null`；除可信自报费用外，由 `src/collect.js` 调用 `computeCost` 计算 |
| `directory`, `title` | 可空会话上下文 |

Cursor 记录可额外包含 `cursorMaxMode`，保存 CSV `Max Mode` 列的布尔值，空白/未知值为 `null`；旧记录允许缺失。该字段不参与事件身份，重导可补齐或更正而不覆盖已知费用；数据库备份会保留它，并严格拒绝非布尔、非 null 的值以及其他未知字段。它与模型名中识别出的 Max 模式独立保存，不能用来推断历史套餐。

新鲜输入不包含缓存读取。缓存命中率是 `cacheReadTokens / (inputTokens + cacheReadTokens)`；缓存写入不进入分母。token、费用和模型按每条请求归属；同一会话换模型时会拆到对应模型。`reasoningTokens` 是输出的一部分，不再额外计价。Cursor 的 `sessionId` 为 `null`，会话聚合略过它。

## 日期与范围

CLI 的 `--since` / `--until`、按天聚合及 Web 服务端周期使用机器本地时区。服务端的本地日期算法集中在 `src/dates.js`：校验真实日历日期，用当地午夜推进日历天，跨 DST 不直接加 `24h`。前端 `web/lib/period.js` 独立处理本地 `YYYY-MM-DD` 的月/年与周一开头的日历；前端日期键使用 `Date` 的本地年月日，不用 `toISOString()` 生成日期键。

Web 查询 `period` 接受 `all`、`today`、`7d`、`30d`、`month`、`custom`，另有 `client`、`since`、`until`。`custom` 必须同时带起止日；预设周期不能带起止日。未知或重复参数为 HTTP 400。查询与启动时的客户端、时间范围取交集，不能扩大启动范围。`scopeRange` 反映启动范围内的活动边界，与当前查询周期无关。

## JSON 形状

Cursor 的 `pricing.modelRates` 额外包含 `maxMode`（目录匹配后多出的模式词）、`variableRates`、`priceFetchedAt`、`retained`。同一原始模型 ID 的请求跨多个上下文价格时，`variableRates` 为 true，`source` 为 null，省略四种单价，避免把一档价格当作整行价格；各请求费用仍按实际匹配档位计算。模型展示名及 `modelId` 来自匹配目录，无法匹配时保留原模型名。目录别名与价格元数据随 SQLite 备份保存。

报告命令的 `--json` 由 `src/payload.js` 构造：元信息 `tool`、`version`、`generatedAt`、`range`、`clientsFilter`，以及 `totals`、`cacheHitRate`、`clients`、`models`、`daily`、`monthly`、`sessions`、`pricing`、`warnings`。`pricing` 有 `sources`、`configDir`、`unpricedModels`、`updates`、`modelRates`。`clients` 每项的总量和命中率都从过滤后的记录计算。`models` 按客户端和展示名聚合，并保留原始 `modelIds`；价格细节仍在 `modelRates` 按原始 ID 输出。`refresh --json` 返回数据库刷新状态，不是报告载荷。

`GET /api/data` 保留这份报告载荷，额外提供：

- 基础 Web 聚合：`heatmap`、`trend`、`trend7`、`trend90`、`trendByAgent`、`hourly`、`today`、`last7Days`、`last30Days`、`thisMonth`、`activeDays`、`streaks`、`peakDay`、`topSessions`、`longestSession`、`activityRange`、`timezone`。
- 快照/选择：`snapshot`、`view`、`scopeRange`、`selection`。`selection` 的趋势/热力图最多呈现最后 366 天，`totals` 与 `comparison` 仍用完整请求范围。
- 费用说明：`costCoverage` 按 `reported`、`cursor`、`user`、`litellm`、`builtin`、`unknown` 分来源统计请求和金额，并给出未定价与使用缓存价格回退的请求数。
- 相邻周期：`comparison` 用等日历天数的前一段作为基准，给出贡献和覆盖情况；没有起始日期时默认比较截至选定终点/今天的七天。前段越过启动范围时返回不可比较状态。

本期、上期的费用覆盖统计使用同一份价格快照；无基准、范围不完整等情况由比较结果显式表达，不能靠空数组推断。

`topSessions` 和 `longestSession` 中的 `durationMs` 是原始跨度，`activeMs` 将请求间空闲间隔封顶为五分钟；最长会话按 `activeMs` 排名。新增 Web 字段应维持 CLI JSON 的既有字段。
