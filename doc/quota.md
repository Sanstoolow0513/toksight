# 订阅额度（Codex / Kimi Code）

`toksight quota` 与 Web 今日概览的“订阅额度”卡片显示订阅的限流窗口。只支持 Codex 与 Kimi Code。
用户用法见双语 README；本文记录实现口径。

## 数据模型

`src/quotamodel.js` 定义与提供商无关的快照，`src/quota.js` 的 `collectQuotas` 汇总：

```text
QuotaSnapshot { client, label, plan, source: 'local' | 'api', fetchedAt, observedAt, limitId?, windows, error?, warnings? }
window        { id, label, windowMinutes, usedPercent (0–100 | null), used?, limit?, remaining?, resetsAt (ISO | null), reset }
error         { code, message }
```

- 窗口按长度分类：`300` 分钟为 `5h`，`10080` 为 `week`，其他为 `2h` / `3d` / `45m` 等通用标签；Kimi 月度池为 `month`。
  不按提供商槽位（primary / secondary）推断窗口，部分 Codex 套餐的 primary 就是周窗口，且没有 5 小时窗口。
- 重置时间已过，或无重置时间但观察时刻距今超过窗口长度时，窗口已滚动：`reset: true`、`usedPercent: null`，
  并去掉计数，不展示过期百分比。百分比截断到 0–100。
- `quota --json` 与 `GET /api/quota` 返回 `{ tool, version, generatedAt, quotas }`（Web 另含 `offline`），
  不并入报告载荷，也不改变已有 `--json` 字段。

## Codex（离线）

`src/codexquota.js` 扫描 `CODEX_HOME/sessions`（默认 `~/.codex/sessions`）的 JSONL，读取
`payload.type === 'token_count'` 行的 `rate_limits`，与 `info` 无关（旧版本 `info: null` 时采集器跳过用量，但额度仍可读）。

- 取所有会话中**事件时间最新**、至少含一个窗口的快照；没有 `timestamp` 时用文件 mtime。文件按 mtime 倒序读取，
  mtime 早于当前最新事件一分钟以上的文件不会含更晚事件，直接停止，避免每次重读全部历史。
- 支持 `primary` / `secondary` 对象（`used_percent`、`window_minutes`、`resets_at` 秒/毫秒/ISO 或
  `resets_in_seconds` 相对事件时间），以及早期扁平字段 `primary_used_percent` / `primary_window_minutes` 等。
- `plan_type` 原样作为 `plan`；无数据时返回 `CODEX_NO_RATE_LIMITS`。

## Kimi Code（联网，显式触发）

本地 Kimi 文件没有额度数据。`src/kimiquota.js` 只在 `toksight quota`（未加 `--offline`）或
`POST /api/quota/refresh` 时调用 `GET <base_url>/usages`：

- 运行时读取 `KIMI_CODE_HOME`（默认 `~/.kimi-code`）下 `credentials/kimi-code.json` 的 `access_token`，
  只作为 `Authorization: Bearer` 发送；不打印、不返回、不持久化；不刷新令牌、不写凭据文件（Kimi 会轮换
  refresh token，只能由 Kimi Code 自己续期）。
- `expires_at` 按 epoch 秒解释（kimi-cli 写入 `time.time() + expires_in`），大于 1e12 视为毫秒；距过期不足 30 秒
  直接返回 `KIMI_TOKEN_EXPIRED`（“token expired, open Kimi Code to refresh”），不发请求。
- base URL 依次取 `KIMI_CODE_BASE_URL`、`config.toml` 中第一个合格的 `base_url`、默认
  `https://api.kimi.com/coding/v1`；只接受 `https://api.kimi.com` / `https://api.kimi.ai` 的 `/coding` 路径，令牌不会发往其他主机。
  请求超时 8 秒，`redirect: 'error'`。
- 错误码：`KIMI_NO_CREDENTIALS`、`KIMI_BAD_CREDENTIALS`、`KIMI_TOKEN_EXPIRED`、`KIMI_UNAUTHORIZED`（401/403）、
  `KIMI_UNSUPPORTED`（404）、`KIMI_HTTP`、`KIMI_TIMEOUT`、`KIMI_NETWORK`、`KIMI_BAD_RESPONSE`、
  `KIMI_UNSUPPORTED_RESPONSE`（无可识别窗口，消息列出顶层字段名）；未联网时为 `KIMI_OFFLINE` / `KIMI_NOT_FETCHED`。

响应解析（数字常为字符串，未知字段忽略）：

| 字段 | 解释 | 依据 |
| --- | --- | --- |
| `limits[].window.{duration,timeUnit}` + `detail.{limit,used,remaining,resetTime}` | 滚动窗口（通常 300 分钟 = 5h）；缺 `used` 时用 `limit - remaining` | kimi-cli `/usage`、CodexBar |
| `usage.{limit,used,remaining,resetTime}` | 周额度（kimi-cli 默认标签 “Weekly limit”），记为 10080 分钟 | kimi-cli、CodexBar；“周”是假设 |
| `usages.limit_5h` / `limit_7d` / `limit_month_total` `{used_ratio, reset_time}` | 新版比例池；其他 `limit_*` 以去前缀的键名作为通用窗口 | CodexBar |
| `user.membership.level` | 原样作为 `plan`（如 `LEVEL_INTERMEDIATE`） | CodexBar、UsageOwl |

同一窗口同时有计数和比例时保留计数，并显示更高的已用百分比。重置字段兼容 `resetTime` / `resetAt` / `reset_time` / `reset_at`。
测试使用 `test/fixtures/quota/kimi-usages.json`，不访问真实 API。

## Web

`GET /api/quota` 每次重读 Codex 日志，Kimi 返回服务进程内存中的上次结果（未查询时为 `KIMI_NOT_FETCHED`），
不联网。`POST /api/quota/refresh` 才查询 Kimi，并发请求共享一次；它虽不写数据，但会使用用户令牌联网，
因此与写路由一样要求 POST、回环 Host 和同源 Origin。`--offline` 启动时刷新返回 `KIMI_OFFLINE`，按钮禁用；
`--client` 启动范围同样限制额度客户端。

`QuotaCard` 位于今日概览 KPI 下方，`useQuota` 在挂载、窗口聚焦和数据库刷新后 GET，按钮才 POST。
卡片带 `.no-export`，PNG 导出不包含实时额度。重置时间按报告时区显示绝对时间与倒计时。
