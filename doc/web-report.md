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
| `/api/sync/status` | GET/HEAD | GitHub 备份设置与上次备份 / 恢复记录，不联网、不返回令牌；见[GitHub 备份](github-backup.md) |
| `/api/sync/config` | POST | 保存仓库与令牌（JSON：`repo`、`token`、`clearToken`） |
| `/api/sync/upload` | POST | 把快照上传到私有仓库的 `toksight/usage.sqlite` |
| `/api/sync/restore` | POST | 下载、校验并合并远端备份，合并前保存本机安全副本 |

默认回环绑定时，所有已定义 API 路由都拒绝非 localhost 的 Host 头，防止 DNS rebinding；写路由还拒绝跨站 Origin / Fetch 请求。Next 开发代理允许本机不同端口。显式 `--host 0.0.0.0` 意味着主动对局域网开放，不适用回环 Host 限制。新增 API 必须纳入相同检查；不提供修改 Agent 配置的写路由。`/api/sync/*` 另外只接受本机回环地址的请求（不论绑定地址）。

## 页面与数据流

首次未完成引导时，主内容区显示 `PriceSetup`，可立即下载价格或本地继续，状态保存在数据库。
价格页提供完整目录、页头设置浮层中的价格来源与自动更新开关，以及顶栏“重置价格库”入口（与更新单价并列）；`usePriceDatabase` 独立加载状态。
`PriceReset` 使用原生 dialog，提供范围说明、取消、忙状态和失败重试；成功后关闭弹窗并返回建库引导。
离线时禁用联网更新；本地继续不能在下一次 GET 自动下载。具体来源和历史语义见[本机价格库](local-pricing.md)。

Next App Router 从 `frontend/` 静态导出为 `frontend/out/`，生产由 CLI 托管；旧 `web/` 已移除。
`app/page.js` 挂载 `Workspace`，`lib/useWorkspace.js` 集中管理日历选区与缩放、时区、刷新、图片导出、价格初始化和数据库传输状态。
`AppHeader` 为固定顶部工具栏：左侧品牌标（按钮，回到今天；当前页名为视觉隐藏的唯一 `h1`），右侧 `PageActions` 页面操作、配色菜单（`MenuButton`，支持 Escape 关闭和焦点返回）、语言切换与 GitHub 链接，全部为带按钮提示的 `IconButton` / `IconLink`。
`Sidebar` 分为数据洞察和工作台管理两组，底部依次为本机说明、时区入口与收起按钮；≤700px 改为吸附横向导航。
视觉为“素面工作台”设计语言（令牌见 `frontend/app/styles/tokens.css`）：纯色底面上无外框的平面面板（统一圆角、内部发丝线分隔、无投影），52px 顶栏与 220px 侧栏；全站一种无衬线字体（Geist + 中文无衬线回退）与 tabular 数字，Mono 仅用于模型 ID 与路径；根字号 16px、正文 15px，任何文字不小于 13px；强调橙只用于选中、峰值、输入 token、今天与焦点，缺失 / 未来 / 剩余额度为浅色平涂，热图为五档灰度。样式按 `@layer` 分为 tokens / base / primitives / shell / components / pages / utilities。
`PageActions` 在顶栏以图标按钮提供刷新和图片导出，价格页换为更新单价与重置；卡片专属操作（刷新 Kimi 额度）留在卡片内。`Settings` 提供外观、语言、时区、SQLite 备份 / 合并，以及 `GitHubBackup` 面板（仓库与令牌、上次备份、上传 / 恢复按钮与恢复确认对话框，错误内联显示）。
共享原语位于 `components/ui/`：`Segmented`（配色、指标等共用，支持方向键、Home / End 与单一 Tab 焦点）、`Button`、`IconButton` / `IconLink`（`label` 即可访问名称与按钮提示 `AnchorTip`，不用 `title`）、`MenuButton`、`Panel`、`Stat`、`Meter`（额度窗口，`role="meter"`）、`Badge`、`Field` 与 `Tooltip` + `useTip`（小时柱、日历格、周单元和账表行共用的指针 / 焦点定位；提示为 fixed 定位，显示期间任一祖先或窗口滚动（捕获阶段监听）、滚轮或窗口缩放都会隐藏它，只有锚定在当前焦点元素上的提示在该元素仍处于滚动框内时跟随移动；按钮提示同样在滚动、滚轮与缩放时隐藏）。视觉与交互以 `design-spec.md` 为准。

`PriceCatalog` 从独立的 `/api/prices` 读取第一方 LiteLLM 目录：页头 plate 含搜索、“只看用过的模型”开关（`role="switch"`）、元信息行与设置浮层，下面是厂商筛选标签（`aria-pressed`）和按厂商分区（用过的厂商在前、分区标题吸顶）的卡片网格。
卡片 Logo 由 `ProviderLogo` 渲染（`frontend/public/logos/`，LobeHub Icons，MIT；单色标志用 CSS mask 跟随主题，彩色标志用 `<img>`，未知厂商为字母块）；模型家族（claude / gemini / kimi / grok）优先于厂商 Logo。
单价按美元/百万 token 以 2–4 位小数显示（`fmtUnitPrice`），缓存回退加星号说明；长上下文档位显示为标记，`maxInputTokens` 已知时显示最大输入。
“价格明细”展开档位、计费条件、目录 ID、匹配到的日志模型名（`usedAs` 与官方别名）和来源链接。全部模式每个厂商先预览五张卡片，再以“查看全部”切到该厂商；不分页。
价格与历史都在同一 SQLite 读事务内获取，不触发采集或联网。`usePriceCatalog` 只在价格页挂载，取消
旧请求并检查序号，页面关闭清理轮询；目录每分钟及回到前台重读，单项历史按需读取。页面为固定高度，分区区域内部滚动；窄屏回到正常页面流。切到价格或设置会停止用量报告请求。

今日详情之后的 `QuotaCard`（`useQuota`，经 `DayBody` 的 `quota` 插槽放在最后）显示 Codex / Kimi Code 订阅额度，只有“刷新 Kimi 额度”按钮会联网；卡片不进入 PNG 导出，细节见[订阅额度](quota.md)。

Today 请求 `period=custom&since=<今天>&until=<今天>&timezone=<IANA>`（所有 Agent），`TodayDashboard` 以 `Kpis` 指标面板开头（标题行为日期、星期与“截至”时间），之后是 `DayBody`，最后是近 30 天的 `TrendCard`（另一条 `since=<今天−29>` 请求）。
Tokens 与费用在昨日有非零基数时展示相对变化，文案明确比较昨日全天；费用比较要求两期请求均已定价。
`DayBody` 用于概览：`ActivityChart`（`ChartColumn`，副标“24 小时 · 按统计时区”）提供 Tokens / 费用切换，24 个本地小时柱、数量轴、键盘提示和带数值标签的强调色峰值；
`TokenBreakdown`（头部右侧“合计”）以单条堆叠条和点引线图例同时显示四种 token 的数量与占比。“Agent 与模型”表（`Layers3`，副标为当前排序，如“按 Tokens 排序”）可排序、展开和查看明细；
模型只在所属 Agent 下展开，不另设独立模型表，单模型名称直接显示在 Agent 行。
会话初始五条，可展开 API 返回的前十条，显示当前数量和总会话数；PNG 捕获当前展开状态。

日历使用 `CalendarView`，两栏 `minmax(--cal-col-min, --cal-col) 1fr` 占满视口剩余高度（页面不滚动），≤1200px 改为上下堆叠（日历 70vh）。
`Calendar`（日历栏）一次请求全部历史（`since=<首个记录日>&until=<今天>`，首日来自 `scopeRange.firstAt`），按月渲染记忆化的 `MonthBlock`（`role="grid"`，周一开始，月标题吸顶）；第 8 列为 ISO 周单元（`isoWeek` / `weekLabelParts`，跨月的周在两个月块里都显示整周合计，未来日不计）。热度为 `heatLevel(value, heatMax(全部历史))`，滚动时色阶不变。
缩放两级（大 / 紧凑），由按钮、Ctrl/⌘ + 滚轮（累计 40）、双指捏合（1.25 / 0.8）或 `+` / `-` 切换，用 `el.animate` 做 FLIP（360ms，锚点日保持原位，动画中忽略新请求，减少动态效果时直接切换），级别存入 prefs。
选择规则：单击单选、拖动（指针捕获，距边缘 48px 自动滚动）、Shift 区间、Ctrl/⌘ 增减（至少保留一天）、单击周数选整周（Ctrl/⌘ 追加）、Esc 回到今天；未来日不可选。键盘使用 roving tabindex：方向键 ±1 / ±7 天（大档在行尾右移到周单元，周单元上下移动到相邻周行）、Shift+方向键扩展区间、Home / End、PageUp / PageDown、Enter / 空格、Ctrl+空格。悬停或键盘聚焦显示日 / 周提示，拖动时隐藏。
`CalendarDetail`（详情栏）通过 `useSelectionReport` 请求选区：连续区间用 `since` / `until`，不连续时追加 `days=`。头部、四项数字与说明行；单日显示时段条；“用量拆分”按 Agent（`agentRows`）与按模型（`mergedModelRows`，同模型跨 Agent 合并、提示列出 Agent），可切换为会话列表（复用 `SessionRow`）。拆分 / 会话的滚动区 `.dcard-body` 是 `tabIndex=0` 的 `role="region"`（`aria-label` 为 `splitRegion` / `sessionsRegion`），可用键盘聚焦滚动，焦点环画在区域内侧。日格与周单元的焦点环偏移 `--focus-offset-sel`（3px）；选中日获得焦点时选中框改由外圈 `box-shadow` 绘制，焦点环始终在选中框之外。

`AgentTable` 的 Agent 与模型行都提供明细按钮，点击或键盘激活后在行下展开完整统计和模型匹配单价；点击明细不会展开或折叠 Agent。窄表隐藏次要列后仍能查看全部字段，悬停提示保留。

日历选区保存在页面内存（默认今天），刷新页面回到 Today；切换时区会清空选区。选区请求独立于全历史请求，不覆盖日历数据。

`frontend/lib/useReport.js` 将日期范围、`days` 与时区作为请求标识，取消旧请求并校验序号。加载或失败时保留带原范围 / 时区标签的载荷，时区改变则隐藏旧时区数据；选区加载失败在详情栏显示错误和重试。任一已显示数据尚未完成或请求失败时禁止图片导出。切到设置会取消范围与选区请求并清除 loading 状态。刷新先 POST 替换数据库，再重载历史和选区。

`frontend/lib/period.js` 负责时区检测与日期标签运算，每 30 秒及窗口重新获得焦点时更新当前日期。系统模式重新检测浏览器时区；手动时区不随系统变化。切时区后未来的自定义结束日收拢到今天。日期算法详见[数据契约](data-contract.md)。`prefs.js` 管全部 localStorage key：语言、配色、日历缩放级别（`toksight-calendar-zoom`，`large` / `compact`）、表格排序和时区；不再读取旧卡片顺序。`format.js` 按载荷的时区显示会话与页脚时间。

PNG 由 `modern-screenshot` 捕获 `.report`，`.is-exporting` 以不透明底面色承接面板，包含 Today 全部详情，或日历栏中当前可见的月份块与详情栏，以及页脚（日历页平时隐藏页脚，仅导出时显示）；导航、设置、toast、导入对话框不在捕获范围。带 `data-export-clip` 的滚动区只导出与视口相交的子块，其余临时标为 `.no-export`，滚动区在导出时展开。`.no-export` 排除内嵌控件和临时行内明细，`.is-exporting` 关闭过渡并隐藏明细按钮列；Agent 表格采用固定布局，保持模型展开状态和其余数值列宽。
