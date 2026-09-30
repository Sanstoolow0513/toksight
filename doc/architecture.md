# 架构与数据流

## 边界

`toksight` 是 ESM Node.js CLI，要求 Node >=22.5，根包没有运行时依赖。它读取本机 Agent 会话数据；刷新和导入更新自己的 SQLite，价格抓取更新自己的缓存文件，不修改 Agent 数据。`web/` 用 Next.js 构建静态页面，由 CLI 的 `node:http` 服务托管；没有 TUI。`scripts/` 是源码仓库开发工具，不随 npm 包发布。用户命令和选项见双语 README。

## 两条读写路径

```text
Agent 文件 / toksight 中的导入记录
  -> src/clients/* -> collectAll -> 定价与筛选
       -> CLI 文本 / --json
       -> refresh -> SQLite 已提交快照

GET /api/data -> 读取快照 -> 查询范围与筛选 -> buildPayload + Web 聚合
POST /api/refresh -> collectAll -> 事务替换快照
Cursor CSV / 数据库备份 -> 验证并合并 toksight SQLite -> 后续报告读取

web/ 源码 -> Next 静态导出 web/out/ -> src/webserver.js 提供页面与同源 API
```

普通 CLI 报告走 `collectAll`，Web 的 GET 只筛选已提交的快照。首次运行 `web` 若没有快照会采集一次；刷新失败保留旧快照。价格目录的更新与采集分开执行，报告可用已存价格重新定价，不必重扫 Agent 文件。

`collectAll` 返回过滤后的 `entries`、`warnings`、`pricing`，以及未过滤的 `perClient`（每项有 `id`、`label`、`roots`、`entries`，供 `env` 和空状态使用）。`reportedCosts` 用 `WeakSet` 保存自报费用的来源，不给标准记录增加字段。`filterEntries` 由 CLI 采集与 Web 请求共同使用。

## 模块索引

| 位置 | 职责 |
| --- | --- |
| `bin/toksight.js`、`src/cli.js` | 可执行入口与命令分派；解析、采集、渲染和 HTTP 逻辑分别放在对应模块 |
| `src/args.js` | 命令与参数解析，支持 `--flag value` 和 `--flag=value`；测试可注入 `now` |
| `src/collect.js` | 所有客户端采集、导入记录合并、价格与筛选；`collectAll(opts, { env, home })` |
| `src/clients/`、`src/fsutils.js` | 各 Agent 解析器、SQLite 只读打开、文件遍历和容错 |
| `src/aggregate.js`、`src/dates.js` | 聚合与服务端日期运算（CLI 本地时区，Web 可选 IANA 时区） |
| `src/payload.js`、`src/render.js`、`src/format.js` | CLI JSON 契约、文本输出、ANSI/数字格式 |
| `src/database.js`、`src/usageimports.js` | 项目数据库、持久导入、快照和跨进程版本检测 |
| `src/dbtransfer.js`、`src/dbcommand.js` | SQLite 备份验证/合并与 CLI 文件操作 |
| `src/cursorcsv.js`、`src/cursorpricing.js` | Cursor Usage Events 解析及官方价格目录缓存 |
| `src/cursorpricepages.js`、`src/cursormodels.js` | 自动发现官方模型详情及价格档位，以目录驱动的名称/别名匹配解析 Cursor 模式 |
| `src/pricing.js`、`src/pricecatalog.js`、`src/costcoverage.js` | 价格来源、模型身份/作用域、费用来源统计 |
| `src/webservice.js`、`src/webquery.js` | Web 快照服务、查询范围交集、共享刷新任务 |
| `src/webdata.js`、`src/comparison.js` | Web 补充聚合、等日历天数的相邻周期比较 |
| `src/webserver.js` | 静态资源与本机 HTTP API |
| `web/app/`、`web/components/`、`web/lib/` | 静态报告页面、组件、独立可测的前端计算与偏好 |

采集口径见[采集器](collectors.md)，稳定输出见[数据契约](data-contract.md)，持久化见[存储与定价](storage-pricing.md)。
