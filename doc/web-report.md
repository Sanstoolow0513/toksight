# Web 服务与报告页

## HTTP 与安全边界

`src/webserver.js` 默认绑定 `127.0.0.1:4729`，使用 Node 内置 `node:http`，页面来自 `frontend/out/`。未构建 `index.html` 时 `/` 显示内置构建指引，API 仍可用。`frontend/out/_next/` 的非 HTML 静态资源用 immutable 缓存，其他资源 `no-cache`；路径越界返回 403。未定义的 `/api/*` 返回 JSON 404。`--api-only` 不托管静态页面。

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/api/data` | GET/HEAD | 从已提交快照生成筛选后的报告；参数见[数据契约](data-contract.md) |
| `/api/refresh` | POST | 重扫 Agent 并事务替换快照 |
| `/api/prices/update` | POST | 本机强制下载 LiteLLM 第一方价格 |
| `/api/prices/reset` | POST | 清除价格、历史及下载缓存，返回建库引导，保留用量与导入；本服务忙时返回 409 |
| `/api/prices/status` | GET/HEAD | 本地价格/历史版本数、引导完成与自动更新状态 |
| `/api/prices` | GET/HEAD | 已提交本地目录；可用单个 key 参数读取某项价格历史 |
| `/api/setup` | POST | 首次建库或保存自动更新偏好；参数为布尔 offline / autoUpdate |
| `/api/export/db` | GET/HEAD | 下载独立 SQLite 备份 |
| `/api/import/db` | POST | 验证并合并 SQLite 备份 |
| `/api/quota` | GET/HEAD | Codex 本地额度 + 内存中上次 Kimi 结果，不联网；见[订阅额度](quota.md) |
| `/api/quota/refresh` | POST | 查询 Kimi Code 额度（离线启动时跳过），按写路由做 Origin 检查 |

默认回环绑定时，所有已定义 API 路由都拒绝非 localhost 的 Host 头，防止 DNS rebinding；写路由还拒绝跨站 Origin / Fetch 请求。Next 开发代理允许本机不同端口。显式 `--host 0.0.0.0` 意味着主动对局域网开放，不适用回环 Host 限制。新增 API 必须纳入相同检查；不提供修改 Agent 配置的写路由。

## 页面与数据流

首次未完成引导时，主内容区显示 `PriceSetup`，可立即下载价格或本地继续，状态保存在数据库。
价格页提供完整目录、价格/历史版本数、最近记录变化时间、自动更新开关及顶栏“重置价格库”入口（与更新单价并列）；`usePriceDatabase` 独立加载状态。
`PriceReset` 使用原生 dialog，提供范围说明、取消、忙状态和失败重试；成功后关闭弹窗并返回建库引导。
离线时禁用联网更新；本地继续不能在下一次 GET 自动下载。具体来源和历史语义见[本机价格库](local-pricing.md)。

Next App Router 从 `frontend/` 静态导出为 `frontend/out/`，生产由 CLI 托管；旧 `web/` 已移除。
`app/page.js` 挂载 `Workspace`，`lib/useWorkspace.js` 集中管理筛选、时区、刷新、图片导出、价格初始化和数据库传输状态。
`AppHeader` 为固定顶部工具栏，提供品牌、当前页名（页面唯一 `h1`，正文不再有大标题、眉标和介绍行）、`PageActions` 页面操作、配色和语言；配色菜单支持 Escape 关闭和焦点返回。
`Sidebar` 分为数据洞察和工作台管理两组，支持折叠，底部提供本机说明与时区入口；≤700px 改为吸附横向导航。
视觉为“素面工作台”设计语言（令牌见 `frontend/app/styles/tokens.css`）：纯色底面上无外框的平面面板（统一圆角、内部发丝线分隔、无投影），52px 顶栏与 220px 侧栏；全站一种无衬线字体（Geist + 中文无衬线回退）与 tabular 数字，Mono 仅用于模型 ID 与路径；根字号 16px、正文 15px，任何文字不小于 13px；强调橙只用于选中、峰值、输入 token、今天与焦点，缺失 / 未来 / 剩余额度为浅色平涂，热图为五档灰度。今日把额度与 Token 构成并排、时段分布整行。样式按 `@layer` 分为 tokens / base / primitives / shell / components / pages / utilities。
`PageActions` 在顶栏提供刷新和图片导出，价格页换为更新单价与重置，≤760px 收为图标按钮；卡片专属操作（刷新 Kimi 额度）留在卡片内。`Settings` 提供外观、语言、时区、SQLite 备份 / 合并。
共享原语位于 `components/ui/`：`Segmented`（配色、语言、指标、月 / 年、快捷范围与 Agent 标签共用，支持方向键、Home / End 与单一 Tab 焦点）、`Button` / `IconButton`、`Panel`、`Stat`、`Meter`（额度窗口，`role="meter"`）、`Badge`、`Field` 与 `Tooltip` + `useTip`（小时柱、热图格和账表行共用的指针 / 焦点定位）。视觉与交互以 `design-spec.md` 为准。

`PriceCatalog` 从独立的 `/api/prices` 读取第一方 LiteLLM 目录，支持模型搜索、提供商筛选和每页 50 条。
单价按美元/百万 token 显示并保留小数精度，缓存回退加星号说明。点击模型在行下展示原始 ID、计费渠道、
提供商、来源链接、上下文档位；有历史的记录再按 key 请求版本。
价格与历史都在同一 SQLite 读事务内获取，不触发采集或联网。`usePriceCatalog` 只在价格页挂载，取消
旧请求并检查序号，页面关闭清理轮询；目录每分钟及回到前台重读，单项历史按需读取。手机表格在自己的
可聚焦滚动区横向查看，不扩大页面宽度。切到价格或设置会停止用量报告请求。

今日指标下方、与 Token 构成并排的 `QuotaCard`（`useQuota`，经 `DayBody` 的 `quota` 插槽放入）显示 Codex / Kimi Code 订阅额度，只有“刷新 Kimi 额度”按钮会联网；卡片不进入 PNG 导出，细节见[订阅额度](quota.md)。

Today 请求 `period=custom&since=<今天>&until=<今天>&timezone=<IANA>`，`TodayDashboard` 展示四项统一 KPI；每张卡由标题区与灰色内嵌数值区组成。
Tokens 与费用在昨日有非零基数时展示相对变化，文案明确比较昨日全天；费用比较要求两期请求均已定价。
`DayBody` 复用于概览和日历详情：`ActivityChart` 提供 Tokens / 费用切换，24 个本地小时柱、数量轴、键盘提示和带数值标签的强调色峰值；
`TokenBreakdown` 以单条堆叠条和点引线图例同时显示四种 token 的数量与占比。Agent / 模型仍可排序、展开和查看明细。
`hasModelComparison` 仅在任一 Agent 有多个模型时保留独立模型排行，单模型名称直接显示在 Agent 行。
会话初始五条，可展开 API 返回的前十条，显示当前数量和总会话数；PNG 捕获当前展开状态。

日历使用 `CalendarView`：全宽范围总量先于月历与单日详情；宽屏左侧为月历与趋势、右侧为详情。窄屏、年历 / 长范围按日历、详情、趋势排列；选择日期后滚动到详情并避开手机吸附导航，键盘激活聚焦详情标题，“返回日历”聚焦所选日期格。范围总量还提供趋势跳转。所有详情进入正常页面流。`HeatGrid` 取 `daily`，五档背景映射同时用于日期格和图例；`fmtTokensShort` 在窄格使用三位、最窄格两位有效数字，标签和提示保留完整格式。Agent 取 `clients`，模型取 `models`，导航边界取 `scopeRange`。

`AgentTable` 与 `ModelTable` 的每行都提供明细按钮，点击或键盘激活后在行下展开完整统计和模型匹配单价；点击明细不会展开或折叠 Agent。窄表隐藏次要列后仍能查看全部字段，悬停提示保留。

日历保留 1D / 7D / MTD / 30D、月 / 年模式、月份直达、自定义首尾日期和 Agent 筛选。拒绝反向、无效或未来结束日；重置为当月和全部 Agent。条件保存在页面内存，刷新页面回到 Today。`useDayReport` 独立请求所选日期并沿用 Agent 和时区，不覆盖范围报告。日期按钮或 ‹ / › 直接切换；月 / 年模式跨周期同步移动范围，快捷 / 自定义范围的步进限制在范围内。

`frontend/lib/useReport.js` 将日期、Agent、时区作为请求标识，取消旧请求并校验序号。加载或失败时保留带原日期 / Agent / 时区标签的载荷，时区改变则隐藏旧时区数据；单日加载失败显示错误和重试。任一已显示数据尚未完成或请求失败时禁止图片导出。切到设置会取消范围与单日请求并清除 loading 状态。刷新先 POST 替换数据库，再重载当前范围和单日。

`frontend/lib/period.js` 负责时区检测与日期标签运算，每 30 秒及窗口重新获得焦点时更新当前日期。系统模式重新检测浏览器时区；手动时区不随系统变化。切时区后未来的自定义结束日收拢到今天。日期算法详见[数据契约](data-contract.md)。`prefs.js` 管全部 localStorage key：语言、配色、日历模式、表格排序和时区；不再读取旧卡片顺序。`format.js` 按载荷的时区显示会话与页脚时间。

PNG 由 `modern-screenshot` 捕获 `.report`，`.is-exporting` 以不透明底面色承接面板，包含 Today 全部详情或日历范围与单日详情、筛选摘要和页脚；导航、筛选操作、设置、toast、导入对话框不在捕获范围。`.no-export` 排除内嵌控件和临时行内明细，`.is-exporting` 关闭日期选中环过渡并隐藏明细按钮列；Agent 表格采用固定布局，保持模型展开状态和其余数值列宽。
