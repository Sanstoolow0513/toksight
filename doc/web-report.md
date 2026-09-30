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

Next App Router 静态导出为 `web/out/`，生产由 CLI 托管。页面默认打开 Today，采用全高侧栏与主内容左右分区，不设独立顶栏。`Sidebar` 顶部展示品牌，今天 / 日历 / 设置导航组垂直居中，底部提供配色、语言与时区入口；导航项至少 48px 高，偏好按钮至少 44×44px。侧栏从视口顶部吸附，矮窗口内可独立滚动；≤600px 收为顶部紧凑区域，保留品牌、偏好切换与横向导航。侧栏为纯灰底，主内容区保留点阵。`ReportActions` 在内容顶部提供刷新、更新单价、图片导出；`Settings` 管时区、SQLite 备份 / 合并与 Cursor CSV。视觉与交互以 `design-spec.md` 为准。

Today 请求 `period=custom&since=<今天>&until=<今天>&timezone=<IANA>`，首先展示四项 KPI，`DayBody` 直接铺开小时分布、Agent / 模型、跨 Agent 模型和会话。日历使用 `CalendarView`：月历与单日详情左右排列，窄屏上下排列，年历 / 长范围在上方；所有详情进入页面正常流，不再使用展开弹层、拖拽排序或分页卡片堆。月历下显示范围总量与 `TrendCard`。`HeatGrid` 取 `daily`，Agent 取 `clients`，模型取 `models`，导航边界取 `scopeRange`。

日历保留 1D / 7D / MTD / 30D、月 / 年模式、月份直达、自定义首尾日期和 Agent 筛选。拒绝反向、无效或未来结束日；重置为当月和全部 Agent。条件保存在页面内存，刷新页面回到 Today。`useDayReport` 独立请求所选日期并沿用 Agent 和时区，不覆盖范围报告。日期按钮或 ‹ / › 直接切换；月 / 年模式跨周期同步移动范围，快捷 / 自定义范围的步进限制在范围内。

`web/lib/useReport.js` 将日期、Agent、时区作为请求标识，取消旧请求并校验序号。加载时保留带原日期 / Agent / 时区标签的载荷，时区改变则隐藏旧时区数据；单日加载失败显示错误和重试。任一已显示数据尚未完成或请求失败时禁止图片导出。切到设置会取消范围与单日请求并清除 loading 状态。刷新先 POST 替换数据库，再重载当前范围和单日。

`web/lib/period.js` 负责时区检测与日期标签运算，每 30 秒及窗口重新获得焦点时更新当前日期。系统模式重新检测浏览器时区；手动时区不随系统变化。切时区后未来的自定义结束日收拢到今天。日期算法详见[数据契约](data-contract.md)。`prefs.js` 管全部 localStorage key：语言、配色、日历模式、表格排序和时区；不再读取旧卡片顺序。`format.js` 按载荷的时区显示会话与页脚时间。

PNG 由 `modern-screenshot` 捕获 `.report`，包含 Today 全部详情或日历范围与单日详情、筛选摘要和页脚；导航、筛选操作、设置、toast、导入对话框不在捕获范围。`.no-export` 排除内嵌控件，`.is-exporting` 关闭日期选中环过渡并取消日历吸附，Agent 表格采用固定布局，保持展开状态和列宽。
