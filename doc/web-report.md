# Web 服务与报告页

## HTTP 与安全边界

`src/webserver.js` 默认绑定 `127.0.0.1:4729`，使用 Node 内置 `node:http`，页面来自 `web/out/`。未构建 `index.html` 时 `/` 显示内置构建指引，API 仍可用。`web/out/_next/` 的非 HTML 静态资源用 immutable 缓存，其他资源 `no-cache`；路径越界返回 403。未定义的 `/api/*` 返回 JSON 404。`--api-only` 不托管静态页面。

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/api/data` | GET/HEAD | 从已提交快照生成筛选后的报告；参数见[数据契约](data-contract.md) |
| `/api/refresh` | POST | 重扫 Agent 并事务替换快照 |
| `/api/prices/update` | POST | 强制检查 LiteLLM 与 Cursor 公共价格 |
| `/api/import/cursor` | POST | 导入 Cursor Usage Events CSV |
| `/api/export/db` | GET/HEAD | 下载独立 SQLite 备份 |
| `/api/import/db` | POST | 验证并合并 SQLite 备份 |

默认回环绑定时，所有已定义 API 路由都拒绝非 localhost 的 Host 头，防止 DNS rebinding；写路由还拒绝跨站 Origin / Fetch 请求。Next 开发代理允许本机不同端口。显式 `--host 0.0.0.0` 意味着主动对局域网开放，不适用回环 Host 限制。新增 API 必须纳入相同检查；不提供修改 Agent 配置的写路由。

## 页面与数据流

Next App Router 应用静态导出为 `web/out/`，生产环境由 CLI 托管，不用 `next start`。页面展示一个日历月、年或自定义范围：顶栏、筛选栏、范围/Agent 摘要与 KPI、可重排的热力图、趋势图和 Agent 表三张卡片、页脚。Token 与费用同时呈现；Agent 行可展开模型；Tokens/Cost 表头只控制排序，没有指标切换。`design-spec.md` 是视觉与交互规范。

主报告每次请求一个本地日历范围：`period=custom&since=<首日>&until=<末日>`，选择 Agent 时附加 `client`。筛选栏提供 1D（今天）、7D、MTD（本月至今）、30D、月份直达与包含首尾日期的自定义范围；日期输入拒绝无效日期、反向范围和未来结束日。条件只保存在 React 状态，不写页面 URL 或新增服务，仍依赖现有本地 API。快捷范围包含今天并按本地日历天计算，跨午夜与刷新时跟随当天。重置为当月、全部 Agent。

热力图取 `daily`，Agent 列表取 `clients`，模型取按客户端/展示名归并的 `models`；导航边界取 `scopeRange`。自定义范围最多 62 天用带月/日标签的日历，更长范围按年分组周网格。`TrendCard` 从筛选后的 `daily` 补零，不使用固定最近 30 天的 API `trend`；单日用 `hourly`，超过 62 个已过日期按月汇总，首尾月份仅含所选日期。`web/lib/useReport.js` 取消/序号校验旧请求，加载时保留带原周期和 Agent 标签的旧载荷；失败明确提示仍显示旧结果，未完成筛选时禁用图片导出。刷新先 POST 数据库更新，再重载当前报告及已加载的单日数据。

双击热力图卡片打开 `ExpandedHeatmap`：报告卡片原位隐藏，展开层放在 `.report` 外，避免推动下面内容；用克隆快照在卡片与弹层间过渡。`useDayReport` 独立请求 `since=until=<日>` 并沿用 Agent，读取当天的 `totals`、`hourly`、`clients`、`models`、`topSessions`，不覆盖主报告。`DayDeck` 把小时、可展开 Agent、跨 Agent 模型表与会话按高度分页；当天 KPI 在日历下。月/年模式跨周期步进会同步移动主报告；快捷/自定义范围的单日步进限制在所选范围内。

`web/lib/period.js` 管本地日历与周一开头的周；`web/lib/report.js` 管纯聚合；`web/lib/deck.js` 管单日卡片装页；`web/lib/prefs.js` 管所有 localStorage key；`web/lib/i18n.js` 管中英文案。PNG 导出由 `web/lib/exportImage.js` 用 `modern-screenshot` 截取 `.report` 并排除 `.no-export`；选中日期的环通过 `.report.is-exporting` 隐藏。`AgentTable` 使用固定表格布局，保证导出克隆与页面宽度一致。
