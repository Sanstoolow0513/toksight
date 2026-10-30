# toksight Web 设计规范

本规范是 toksight Web 报告视觉与交互的唯一依据，描述当前实现，随实现同步更新。

- 前端源码在 `frontend/`。令牌在 `frontend/app/styles/tokens.css`，样式按 `@layer reset, tokens, base, primitives, shell, components, pages, utilities` 分层：`base.css`（重置与元素默认）、`primitives.css`（共享原语）、`shell.css`（外壳）、`report.css`（概览组件）、`calendar.css`（日历）、`manage.css`（价格与设置）、`utilities.css`（工具类与全局动效策略）。
- 共享原语组件在 `frontend/components/ui/`。页面组件只组合原语，不重新实现按钮、分段、提示或面板；新控件先扩展原语。
- 文中的数值都来自 `tokens.css` 或组件 CSS。写成令牌的地方，以令牌为准。

---

## 1. 设计原则：素面工作台（Plain Workbench）

toksight 是每天打开查看的本地数据工具。界面首先要保证信息密度、一致性和可读性，不做风格化装饰。

1. **一种字体。** 全站只用 Geist Sans（配显式中文无衬线回退栈）。侧栏、面板标题、指标数字、表格完全一致，数字统一 `tabular-nums`。Geist Mono 只用于代码类字符串（模型 ID、目录 ID、路径、文件名）。不使用衬线体。
2. **平面分区。** 页面是纯色底面 `--bg`，没有网格和纹理。面板（`.plate`）只是更浅一级的表面 `--surface` 加 `--r-2` 圆角：没有外框、角标或投影。面板内部用 1px 发丝线分隔。
3. **单一强调色。** 橙色 `--signal` 只表达“当前 / 选中 / 峰值 / 焦点”：侧栏选中条、今天标记、多选框、整周选中、峰值柱、输入 token、开关打开、缩放档位点、用过徽标、周号文字（`--signal-ink`）、键盘焦点环。其余元素都用中性灰阶。
4. **外壳只放必要元素。** 顶栏只放 logo 和一排统一的图标按钮。页面没有大标题、眉标和介绍行，内容紧接顶栏开始。按钮的文字放在提示和可访问名称里。
5. **状态表达要克制。** 缺失、未来、剩余额度用平涂浅色（`--empty` / `--empty-faint`），不用阴影线。悬停只改背景或加 1px 内框，不位移，也不加硬边阴影。
6. **紧凑但可读。** 根字号 16px，正文 14–15px，任何文字不小于 13px。统一的面板内边距 `--pad-x 16px` / `--pad-y 12px`、栏距 `--gutter 16px`，控件 28 / 34px，表格行高约 36px。
7. **不展示无依据的数据。** 增幅以昨日全天为基准，没有基数时不显示。未定价的成本明确标注。价格页只展示单价，不显示任何花费。

---

## 2. 基础

所有颜色、字号、字重、间距、圆角、边框、阴影、动效和关键尺寸都在 `tokens.css` 里声明为 CSS 自定义属性，组件样式不写裸值。组件内部的零散偏移（例如日格文字距底 22px / 6px、卡片 `padding 14px`、价格格 `8px 10px`、6px 占比条）可以直接写在组件 CSS 中。

### 2.1 字体

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--font-cjk` | `'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans SC', 'Noto Sans CJK SC', 'Source Han Sans SC'` | 中文回退，保证中文不会落到衬线体 |
| `--font-sans` | `var(--font-geist-sans), -apple-system, 'Segoe UI', var(--font-cjk), sans-serif` | 全部界面文字 |
| `--font-mono` | `var(--font-geist-mono), ui-monospace, 'Cascadia Code', Consolas, var(--font-cjk), monospace` | 只用于模型 ID、目录 ID、路径、文件名、代码 |

- 两种字体都通过 `geist` 包的 `next/font` 打包到本地（`app/layout.js`），不发起远程字体请求。
- **等宽字号规则**：`code, .is-mono { font-size: max(.92em, var(--fs-xs)) }`。等宽文字比周围文字略小，但不低于 13px。例如 13px 说明文字里的内联代码仍是 13px。
- `body`：`var(--fs-base)/var(--lh-body) var(--font-sans)`，`font-variant-numeric: tabular-nums`。

### 2.2 字号、字重、行高

| 令牌 | 值 | 典型用途 |
| --- | --- | --- |
| `--fs-root` | 16px | `html` 根字号 |
| `--fs-xs` | 13px | **下限**。标签、表头、说明、徽标、坐标轴、提示 |
| `--fs-sm` | 14px | 表格、按钮、导航、分段控件、chip、详情卡标题 |
| `--fs-base` | 15px | 正文、面板标题、月标题、大档日格 Tokens、价格数值 |
| `--fs-lg` | 16px | 价格分区标题 |
| `--fs-xl` | 18px | 详情栏标题与四项数字、对话框标题、“只看用过”视图的价格数值 |
| `--fs-2xl` | 22px | Token 构成合计、窄屏指标 |
| `--fs-3xl` | 26px | 指标（`.readout-value`） |
| `--fs-4xl` | 30px | 概览 KPI（`.readout--lg`） |

- 字重只有三档：`--fw-regular 400`、`--fw-medium 500`、`--fw-strong 600`。
- 行高：`--lh-tight 1.15`（指标）、`--lh-snug 1.35`（标签、面板标题）、`--lh-body 1.5`（正文）。大号数字使用字距 `--track-tight -.015em`。
- 标签类文字（`.label`、表头、`.field-label`、`.readout dt`）统一为 `--fs-xs` + `--ink-3`，句首大小写，不全大写，不加字距。
- 面板标题 `.plate-title`：`--fs-base` + `--fw-strong`，前置 16px 图标（`--ink-3`）。

### 2.3 颜色与明暗模式

浅色为 `:root` 默认值，深色为 `:root[data-theme='dark']`。主题偏好有浅色 / 深色 / 跟随系统三种，存于 `localStorage`（`toksight-theme`）。`THEME_BOOT_SCRIPT` 在首次绘制前写入 `data-theme`，所以不会闪屏。

| 角色 | 令牌 | 浅色 | 深色 |
| --- | --- | --- | --- |
| 底面 | `--bg` | `#f3f3f1` | `#111113` |
| 面板 | `--surface` | `#ffffff` | `#1a1a1d` |
| 嵌入层 | `--surface-2` / `--surface-3` | 墨 3.5% / 7% | 白 4% / 8% |
| 浮层 | `--surface-raised` | `#ffffff` | `#222226` |
| 正文 | `--ink` | `#18181a` | `#ececf0` |
| 次级 / 辅助 | `--ink-2` / `--ink-3` | 墨 78% / 66% | 白 80% / 64% |
| 反白 | `--ink-inverse` | `#ffffff` | `#18181a` |
| 分隔线 / 强分隔 | `--line` / `--line-strong` | 墨 9% / 18% | 白 8% / 18% |
| 强调色 | `--signal` | `#e8590c` | `#ff7a2e` |
| 强调文字 | `--signal-ink` | `#b03f00` | `#ff9a5c` |
| 强调浅底 | `--signal-soft` / `--signal-wash` | 12% / 5% | 16% / 6% |
| 成功 | `--ok` | `#2f7a55` | `#74c49a` |
| 警告 | `--warn` / `--warn-soft` | `#8a5a00` / 10% | `#e3b765` / 12% |
| 危险 | `--danger` / `--danger-soft` | `#b23a2b` / 8% | `#ff8f80` / 10% |
| 缺失填充 | `--empty` / `--empty-faint` | = `--surface-3` / `--surface-2` | 同左 |
| 热度 0–4 | `--heat-0…4` | 墨 4.5 / 12 / 26 / 50 / 84% | 白 5 / 13 / 27 / 52 / 86% |
| 热度高档文字 | `--heat-ink-hi` | `#ffffff` | `#18181a` |
| 图表墨色 | `--chart-ink` | 墨 72% | 白 74% |
| 遮罩 | `--scrim` | 墨 40% | 黑 60% |

（“墨”指 `rgb(24 24 26)`，底面类为 `rgb(24 24 22)`；“白”指 `rgb(236 236 240)`。）

- `--ink-2`、`--ink-3` 在两种主题下，对面板和底面的对比度都 ≥ 4.5:1。正文层级靠 `--ink` / `--ink-2` / `--ink-3` 区分，不再用透明度减淡（少数小字例外：日格费用 `.85`、选中 chip 计数 `.7`）。
- **Agent 色**（`--agent-*`，浅 / 深）：Claude `#b0603f` / `#e0906d`、Codex `#2f7f6a` / `#6cc5a8`、Kimi `#3f6db3` / `#86aef0`、ZCode `#8c5aa8` / `#c49ae0`、OpenCode `#77767a` / `#a9a8ae`、其他 `#8a898e` / `#9c9ba1`。组件通过 `agentStyle(id)` 设置 `--agent`，同一个 Agent 在所有页面、卡片和导出图里颜色一致。
- **Token 构成四色**：输入 `--c-input`（= `--signal`）、缓存读 `--c-cache-read`（`#2b2b2e` / `#e2e2e6`）、缓存写 `--c-cache-write`（`#8c8c90` / `#8e8e94`）、输出 `--c-output`（`#c8c8cb` / `#4a4a50`）。深色主题反转明度。对应类名为 `.part-0…3`。
- 不新增颜色。日历、价格、外壳全部复用上表令牌。

### 2.4 间距与布局尺寸

| 令牌 | 值 |
| --- | --- |
| `--sp-1…8` | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40px（4px 基准） |
| `--gutter` | `--sp-4` 16px；≤700px 为 `--sp-3` 12px |
| `--pad-x` / `--pad-y` | 16px / 12px（≤700px 时 `--pad-x` 为 12px） |
| `--ctl-sm` / `--ctl-md` / `--ctl-lg` | 28 / 34 / 40px |
| `--header-h` | 52px |
| `--rail-w` | 220px；≤1200px 为 196px；收起为 64px；≤700px 为 0（改为横向导航） |
| `--content-max` | 1600px |

**日历尺寸令牌**

| 令牌 | 值 | 含义 |
| --- | --- | --- |
| `--cal-col` | 54% | 日历栏宽 |
| `--cal-col-min` | 600px | 日历栏最小宽 |
| `--cal-cell-h` | 104px | 大档日格高 |
| `--cal-cell-compact` | 19px | 紧凑档日格边长 |
| `--cal-gap` | 6px | 大档格间距，也是周单元的左外边距 |
| `--cal-gap-compact` | 3px | 紧凑档格间距 |
| `--hourly-h` | 52px | 详情栏时段条高 |

**价格尺寸令牌**

| 令牌 | 值 | 含义 |
| --- | --- | --- |
| `--price-card-min` | 330px | 卡片网格最小列宽 |
| `--logo-tile` | 40px | 卡片 logo 方块 |
| `--chip-h` | 30px | 厂商 chip 高 |
| `--switch-w` / `--switch-h` | 30px / 18px | 开关轨道；滑块为 `--switch-h − 4px` = 14px |

### 2.5 圆角、边框、阴影

- 圆角：`--r-0 0`、`--r-xs 3px`（紧凑日格、今天日期底色、时段柱顶、热度图例方块）、`--r-sm 4px`（大档日格、周单元、分段内按钮、复选框、徽标块、代码 chip）、`--r-1 6px`（按钮、输入、提示、价格格）、`--r-2 8px`（面板、卡片、对话框、菜单、logo 方块）、`--r-pill 999px`（徽标、chip、开关、计量条、占比条、长上下文胶囊）。
- 边框：`--bw 1px` 发丝线，只用于面板内部分隔、输入框和描边类控件。`--bw-strong 2px` 用于选中框和焦点环。焦点偏移：`--focus-offset 2px`（全局）、`--focus-offset-sel 3px`（日格 / 周单元，避开选中框）、`--focus-offset-inset -2px`（可滚动区域，画在区域内侧）；单选框偏移 `--sel-offset 1px`。描边优先用 `box-shadow: inset 0 0 0 1px …`，这样不改变尺寸。
- 阴影：只有浮层（菜单、提示、对话框、toast）使用 `--shadow-pop`，分段选中滑块和开关滑块使用 `--shadow-thumb`。面板和卡片没有投影。

### 2.6 动效

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--dur-1` | 120ms | 悬停背景 / 颜色、提示出现 |
| `--dur-2` | 200ms | 开关、箭头旋转、缩放档位点、缩放后文字淡入、toast |
| `--dur-3` | 360ms | 日历缩放 FLIP、时段柱升起、计量条 |
| `--ease` | `cubic-bezier(.2, .7, .1, 1)` | 全站统一缓动 |

- `prefers-reduced-motion: reduce` 时（`utilities.css`），所有动画和过渡关闭，`scroll-behavior: auto`。日历缩放改为直接切换，程序触发的滚动改为瞬时。
- 导出图片期间（`.is-exporting`）也关闭全部动画和过渡。
- 动画只用 CSS 和 Web Animations API（`el.animate`），不引入动画库。

---

## 3. 外壳与导航

### 3.1 顶栏 `AppHeader`

- 固定在顶部，高 `--header-h` 52px，左右内边距 `--sp-4`，背景 `--bg`，底边 `--bw solid --line`。
- **左侧只放 logo**：`BrandMark`（3×3 热度格，`--signal` 填充、5 档透明度）28×28，整个 logo 是一个按钮（`.brand`，`aria-label="toksight"`），点击回到“今天”。不显示产品名文字。
- **页面标题**：没有可见标题。当前页名写在视觉隐藏的唯一 `h1`（`.visually-hidden`）里。
- **右侧** `.header-tools`（`gap --sp-2`），顺序为：页面操作 → 竖线 → 配色 → 界面语言 → GitHub。

| 页面 | 页面操作（lucide） | 文案 key |
| --- | --- | --- |
| 今天 / 日历 | `ImageDown` 导出图片、`RefreshCw` 刷新数据库（刷新中图标加 `.spin`） | `exportImage` / `exporting`、`refresh` / `refreshing` |
| 价格 | `RotateCcw` 重置价格库、`RefreshCw` 更新单价（离线时禁用，提示为 `setupOffline`） | `priceReset`、`updatePrices` / `updatingPrices` |
| 设置 | `RefreshCw` | `refresh` |

- 竖线 `.header-divider`：`--bw` × 20px，`--line-strong`，左右 margin `--sp-1`。
- 配色：`MenuButton`，图标随当前偏好变化（`Sun` / `Moon` / `Monitor`），面板内是三选一的 `Segmented`。
- 界面语言：`Languages` 图标，只有图标没有文字。点击在中文和英文之间切换。提示为“界面语言 · 中文 / English”。
- GitHub：`IconLink` + `ExternalLink` 图标，新窗口打开。
- 所有按钮都是同一种 md IconButton（34×34，见 §8.1），页面操作不区分主次。

### 3.2 侧栏 `Sidebar`

- 固定在左侧，宽 `--rail-w`，`padding --sp-4 --sp-3`，分组间距 `--sp-5`，背景 `--bg`，右边 `--bw solid --line`。
- 两组导航：“数据洞察”（今天 `Activity`、日历 `CalendarDays`）和“工作台管理”（价格 `Coins`、设置 `Settings2`）。分组标签为 `--fs-xs --ink-3`。
- 导航项 `.nav-item`：高 36px，`gap 10px`，图标 17px / stroke 1.6，`--fs-sm --ink-2`，圆角 `--r-1`。悬停时背景 `--surface-3`、文字 `--ink`。
- **选中项**：背景 `--surface-3`，文字 `--ink` + `--fw-medium`，`aria-current="page"`。左侧有 3px `--signal` 竖条（`top / bottom 8px`，圆角 `0 2px 2px 0`）。
- **底部** `.rail-bottom`（`gap --sp-3`）：
  - 隐私说明卡 `.privacy-note`：`--surface-2`、`--r-2`、`padding --sp-3`、`--fs-xs --ink-3`，标题为 `--ink-2 --fw-medium`，前置 `ShieldCheck` 15px。
  - 时区行 `.rail-foot`：左侧是统计时区名（`--fs-xs --ink-3`，超长省略），点击进入设置；右侧是收起 / 展开按钮（sm ghost IconButton，`PanelLeftClose` / `PanelLeftOpen`，带 `aria-expanded`）。
- 没有“个人工作台”卡片，也没有单独的时区按钮。
- 收起状态（`--rail-w: 64px`）：隐藏分组标签、导航文字、隐私卡和时区，导航项图标居中，并用原生 `title` 给出页名。

### 3.3 页面框架

- `.workspace-content`：最大宽 `--content-max` 1600px，居中，`padding --sp-4 --sp-6 --sp-5`；≤1200px 为 `--sp-4`，≤700px 为 `--sp-3`。
- 日历页和价格页是**固定高度工作区**（`height: calc(100vh - --header-h)`），页面本身不滚动，只有内部列表滚动。窄屏时恢复整页滚动（见 §4–§6）。
- 加载中：骨架块（`.skel`，`--surface-2` + `pulse`）。报告重载时 `.report.is-loading` 透明度 .55。概览重载时，在内容上方显示一行带呼吸点（`.status-led`）的状态。
- 首次使用没有价格库时，显示引导页 `PriceSetup`（居中面板，`setup-icon` 48px 强调浅底）。
- 报告页脚 `.report-foot`：toksight 版本、刷新时间、价格更新时间、统计时区、估算说明、本机处理说明；有未定价模型时追加一行 `--warn`。日历页只在导出图片时显示页脚。

### 3.4 响应式

- ≤1200px：侧栏 196px。日历改为上下堆叠，概览时段分布与构成改为 `1.5fr / 1fr`。
- ≤1000px：KPI 改为 2×2，时段分布与 Token 构成各占一行。
- ≤760px：日历和价格页恢复整页滚动，见各页。
- ≤700px：侧栏变成吸附在顶栏下方的 44px 横向导航（选中条改为底部 2px 横条，隐藏分组标签和底部区）；顶栏隐藏 GitHub 链接和竖线；表格按容器宽度（container query 650 / 440px）隐藏次要列。
- 支持 360px 手机、平板与宽屏。页面不得横向溢出。

---

## 4. 概览（今天）

概览固定显示**所有 Agent 合计**的当天数据，没有 Agent 筛选条。各 Agent 的拆分由“Agent 与模型”表提供。从上到下：

1. **KPI 面板**（`Kpis size="lg"`，单个 `.plate`）
   - 面板头 `.kpis-head`（`--fs-xs --ink-3`）：左侧为“10月28日 周三 · 截至 17:34”（`generatedAt` 按统计时区格式化，`kpiAsOf`），右侧为 `compareFullDay`“对比昨日全天”（有对比数据时才显示）。
   - 下面是 4 列指标：Tokens、参考费用、缓存命中率、请求，列之间用 `--bw --line` 竖线分隔。标签行图标在前、15px。数值 `--fs-4xl`（≤700px 为 `--fs-3xl`）。
   - 差值徽标 `.delta`：上升为 `--signal-soft` 底 + `--signal-ink`，下降为 `--surface-3` 底 + `--ink-2`。没有基数时不显示；成本只在两天都完全定价时才比较。
   - 每项下面有一行说明（`--fs-xs --ink-2`），例如“输入 … · 输出 …”“每百万 tokens $…”“缓存读取 …”“N 个会话”。
2. **时段分布 + Token 构成**（`.analysis-grid`：`minmax(0, 2fr) minmax(280px, 1fr)`）
   - 时段分布 `ActivityChart`：面板头副标“24 小时 · 按统计时区”。右侧是 sm `Segmented`（Tokens / 参考费用），不进入导出。图表高 196px，左侧有数量刻度（max / ½ / 0），24 根柱 `gap 3px`、`--chart-ink`。峰值柱、悬停柱和焦点柱为 `--signal`，峰值柱上方有数值旗标（`--signal` 底白字）。坐标轴为 `00:00 … 24:00`，底部一行写图例和“峰值 HH:00 · 值”。有值的柱可以用键盘聚焦，并弹出提示。
   - Token 构成 `TokenBreakdown`：合计（`--fs-2xl`）、一条 12px 堆叠条（四色，`gap 2px`）、点引线图例（数量 + 占比）。
3. **Agent 与模型**（`AgentTable`，`.ledger`）
   - 面板头副标随排序变化：“按 Tokens 排序” / “按参考费用排序”（`sortedByTokens` / `sortedByCost`），右侧是计数徽标“N 个 Agent”。
   - 列：Agent、Tokens（可排序）、费用（可排序）、Token 构成（6px 四色条）、缓存命中（32px 计量）、请求、详情按钮。排序表头选中时显示 `--signal` 箭头和 `aria-sort`。排序偏好持久化（`toksight-agent-sort`）。
   - 模型折叠在所属 Agent 下（`.model-group`，`--surface-2` 底），**不另设模型用量表**。表下方是构成图例和操作提示。
4. **会话**：默认显示前 5 条，可以展开到前 10 条（`viewSessions` / `hideSessions`），计数徽标为“可见 / 总数”。每行有序号块（底边 2px Agent 色）、名称、Tokens、费用、元信息行和等宽目录 / 模型行。
5. **订阅额度** `QuotaCard`：计量条 8px，≥80% 用强调色。Kimi 有卡内刷新按钮。
6. **近 30 天趋势** `TrendCard`（`.overview-trend`）：Tokens 柱和费用描边柱，高 88px。
7. 底部 `.history-banner`：一句标语 + 文字按钮“查看历史用量 ↗”（跳到日历，不进入导出）。

当天没有记录时，在构成下方显示嵌入式空状态（`plate--inset`）。

---

## 5. 日历

### 5.1 布局

- 内容区 `padding --sp-6`，两栏 grid：`minmax(var(--cal-col-min), var(--cal-col)) minmax(0, 1fr)`，`gap --gutter`。两栏都占满视口剩余高度，页面本身不滚动，只有日历列表和拆分卡内部滚动。
- ≤1200px：上下堆叠。日历栏高 70vh 在上，详情栏在下，拆分卡不再内部滚动。
- ≤760px：内容区 `padding --sp-3`。隐藏日历头说明和底部提示；大档日格高 64px，只显示日期和 `--fs-xs` 的 Tokens，隐藏费用；紧凑档改为每行 2 个月；详情四项数字改为 2 列。

### 5.2 日历栏（`.calcol.plate`）

1. **头部** `.cal-head`（`padding --pad-y --pad-x`，底边 `--line`）
   - 左侧 `--fs-xs --ink-3`：“所有 Agent 合计 · 单击周数选中整周”（`calAllAgents`）。
   - 右侧 `.cal-tools`（`gap --sp-1`，不进入导出），依次为：`ZoomOut` 缩小 → 档位 → `ZoomIn` 放大 → 竖线 → `CalendarDays` 回到今天。三个按钮都是 md IconButton。已经到头的一侧禁用。
   - 档位 `.zoom-level`：文字“大 / 紧凑”（`--fs-sm --ink-2`，最小宽 40px，居中，`aria-live="polite"`），下面两个 4×4 圆点，间距 3px，未选 `--line-strong`，当前 `--signal`。
2. **星期栏** `.dowbar`（高 30px，与网格同模板，`--fs-xs --ink-3`）：“一 … 日”加“周”；“周”列为 `--ink-2 --fw-medium`。紧凑档隐藏。
3. **滚动列表** `.cal-scroller`：`overflow-y: auto; overscroll-behavior: contain; padding 0 --pad-x --sp-4`。月份块从首条记录所在月一直排到今天所在月，月块间距 `--sp-2`。打开时滚到列表末尾（当前月）；如果最后一个选中日不在本月，就滚到该日。
4. **底部** `.cal-foot`（最小高 36px，顶边 `--line`，`--fs-xs --ink-3`）：左侧是操作提示 `calHint`（Mac 上 `{mod}` 为 ⌘，其他平台为 Ctrl，不进入导出），右侧是热度图例“少 ▢▢▢▢▢ 多”（五个 14px `--r-xs` 方块，对应 `--heat-0…4`）。

### 5.3 月份块

- **月标题** `.mhead`：`position: sticky; top: 0; z-index: 3`，背景 `--surface`，`padding 10px 0 8px`。左侧“2026年10月”（`--fs-base --fw-strong`；英文用 `periodLabel`），右侧本月合计“Tokens · 费用”（`--fs-xs --ink-3`），无记录时显示“无记录”。
- **网格** `.cgrid`：周一开始，`repeat(7, minmax(0, 1fr)) minmax(0, 1fr)`，`gap --cal-gap`。每一行都补满 7 格，月外位置用透明占位格（`.is-blank`），第 8 格是周单元。
- **热度**：`heatLevel(tokens, heatMax(全部已加载历史))`，按 `sqrt(value / max)` 分成 1–4 档，没有用量为 0 档。用全历史的最大值，所以滚动时色阶不变。heat-3/4 上的文字用 `--heat-ink-hi`。

### 5.4 两级缩放

| 档位 | 日格 | 间距 | 每行月数 | 日格内容 | 星期栏 / 周单元 |
| --- | --- | --- | --- | --- | --- |
| **大**（默认） | 宽 = 列宽，高 `--cal-cell-h` 104px，`--r-sm` | `--cal-gap` 6px | 1 | 日期、Tokens、费用 | 显示 |
| **紧凑** | `--cal-cell-compact` 19×19px，`--r-xs` | `--cal-gap-compact` 3px | 3（`repeat(3, auto)`，`space-between`，行距 12px，列距 `--sp-4`） | 只有热度色，数值看提示 | 隐藏 |

- **大档日格文字**（左 6px）：日期距顶 5px，`--fs-xs --fw-medium`；Tokens 距底 22px，`--fs-base --fw-strong --track-tight`（`fmtTokensShort`，例如 `18.4M`）；费用距底 6px，`--fs-xs`，`opacity .85`（`fmtCostShort`，例如 `$75.4`）。已过去但没有用量的日子显示“—”。
- 紧凑档的月标题改为纵向排列，月名 `--fs-sm`，合计在下一行。
- **切换方式**：缩放按钮；在列表上 Ctrl/⌘ + 滚轮（累计 `|deltaY| ≥ 40` 换一档，向上放大，以指针下的日格为锚点）；触屏双指（距离比 > 1.25 放大，< 0.8 缩小）；列表获得焦点时按 `+` / `=` 放大、`-` 缩小。普通滚轮仍是原生滚动。
- 缩放级别持久化（`toksight-calendar-zoom`，默认 `large`）。
- **过渡（FLIP）**：
  1. 记录视口上下 300px 内所有 `.day` / `.wk` / `.mhead` 的位置。
  2. 确定锚点日：指针下的日格 → 视口内的已选日 → 离视口中线最近的日格 → 今天。
  3. 切换 `data-zoom`，调整 `scrollTop`，让锚点保持原位。
  4. 对新视口上下 50px 内的节点：有旧位置的播放 `translate + scale → none`（`transform-origin: 0 0`，月标题只平移不缩放）；新出现的做 `opacity 0 → 1`。
  5. 时长 `--dur-3` 360ms，缓动 `--ease`。过渡期间格内文字隐藏（`.zooming`），结束后用 `--dur-2` 淡入。动画进行中忽略新的缩放请求。
  6. 减少动态效果时直接切换，只保留锚点滚动校正。

### 5.5 日格状态

| 状态 | 样式 |
| --- | --- |
| 热度 | `.lv-0…4` → `--heat-0…4` |
| 未来日 | `--empty-faint` 底、`--ink-3`，不可点，`aria-disabled` |
| 今天 | 日期数字加 `--signal` 底白字（`padding 1px 3px`，`--r-xs`），`aria-current="date"`；紧凑档改为 2px `--signal` 内框 |
| 悬停 | `inset 0 0 0 1px --signal` |
| **单选** | `outline: 2px solid --ink; outline-offset: --sel-offset`（1px） |
| **多选**（2 天以上） | `outline: 2px solid --signal; outline-offset: 0` |
| 键盘焦点 | 焦点环 `2px --signal`，`outline-offset --focus-offset-sel`（3px），始终画在选中框外侧。日格同时被选中并获得键盘焦点时，选中框改用同位置的外圈 `box-shadow`（单选 1px 间隙 + 2px `--ink`，多选 2px `--signal`），焦点环完整显示在选中框之外；周单元同样使用 3px 偏移，整周选中的内框不受影响 |

### 5.6 周单元（ISO 周，第 8 列）

- **外观**：与日格同尺寸。背景 `--surface`，`inset 0 0 0 1px --line-strong`，`--r-sm`，`margin-left --cal-gap`；左侧 −7px 处有一条 1px `--line-strong` **虚线**（上下各缩 6px），表示这是另一个模块。**不参与热度着色**。
- **内容**（距左 7px）：周号 `--fs-xs --fw-strong --signal-ink`，`letter-spacing .02em`；本周 Tokens `--fs-base --fw-strong`；本周费用 `--fs-xs --ink-2`。
- **周号**：ISO 8601（周一开始，含 1 月 4 日的那一周为第 1 周，按周四所在年份归年）。由 `period.js` 的 `isoWeek` / `weekKeys` / `weekLabelParts` 按本地日历日计算。
- **年份前缀**：默认显示 `W42`。如果 ISO 年 ≠ 月块年份，或这一周跨自然年，就加两位年份前缀，例如 `26W1`。2025-12-29 那一行在 2025 年 12 月块和 2026 年 1 月块里都显示 `26W1`。
- **数值**：完整 ISO 周（周一到周日）中截至今天的 `daily` 求和。跨月的周在两个月块里显示**相同的全周合计**。周内无记录时显示“—”。整周都在未来时不显示数值，周号为 `--ink-3`，描边 `--line`，不可点。
- **状态**：悬停背景 `--surface-3`；选区正好等于这一周的可选日时为 `inset 0 0 0 2px --signal` + `--signal-wash` 底（`.is-wsel`）。
- 提示：“2026 年第 42 周 · 10月12日–10月18日”，加 Tokens 和费用。

### 5.7 选择规则

| 操作 | 结果 |
| --- | --- |
| 单击日格 | 只选这一天，锚点设为这一天 |
| 按下拖动 | 从起点到指针所在日连续选中，可以跨月。指针距列表上下边缘 48px 以内时自动滚动，速度为越过距离的 1/3（px/帧）。使用 pointer capture，拖动时隐藏提示 |
| Shift + 单击 | 从锚点到该日选成连续区间 |
| Ctrl/⌘ + 单击 | 增减单个日期，至少保留 1 天，锚点设为该日 |
| 单击周单元 | 选中这一周所有可选日（在列表范围内且 ≤ 今天） |
| Ctrl/⌘ + 单击周单元 | 把这一周追加到当前选区 |
| Esc | 回到只选今天，焦点移到今天 |
| 回到今天按钮 | 只选今天，并平滑滚动到今天：大档时把今天那一行放在列表顶部下方 60px，紧凑档时居中 |

- 未来日不可选。没有记录的日子可以选，计入“已选 N 天”，但不计入“活跃 N 天”和日均。
- 悬停任意日格都显示数据提示：日期 · 周几、Tokens、费用、请求 / 会话、缓存命中；或显示“无活动” / “尚未到来”。
- 不连续选区通过 `days=` 参数一次请求；连续选区用 `since` / `until`。

### 5.8 详情栏（`.dcol`，竖向 flex，`gap --sp-3`）

**A. 头部块** `.dhead.plate`（`padding --sp-3 --pad-x`，行距 10px）
- 第 1 行
  - 单日：标题 `--fs-xl --fw-strong`，例如“10月28日 周三”。旁边 `--fs-xs --ink-3` 写“今天 · 时区”（不是今天时只写时区）。右侧是前一天 / 后一天（sm IconButton，`dayPrev` / `dayNext`，范围到列表首日和今天）。
  - 多选：标题“已选 N 天”；选区正好是一整周时改为“2026 年 W42”（`calWeekHeading`）。旁边写“10月12日 – 10月18日 · 活跃 N 天”，不连续时在结束日期后加“ · 不连续”。右侧文字按钮“清除选择”，只保留最后一天。
  - 标题 `aria-live="polite"`。
- 第 2 行：四项数字 `.dstats`（`repeat(4, auto)`，`space-between`），依次为 Tokens、参考费用、缓存命中、请求。数值 `--fs-xl --fw-strong --track-tight`，标签在下（`--fs-xs --ink-3`）。部分未定价时费用后加 `*`。
- 第 3 行 `.dsub`（`--fs-xs --ink-3`，单行省略，与上一行间距收紧 `--sp-1`）：
  - 单日：“输出 {output} · 每百万 tokens {rate} · {n} 个会话”
  - 多选：“活跃日均 {tokens} · {cost} · {n} 个会话”
- 没有记录时，第 2 行改为“这一天没有记录。” / “所选日期没有记录。”，后面的卡片不显示。出错时显示 `.notice` 加重试按钮。

**B. 时段条**（**只在单日时显示**）`.dcard.hourly`（`padding 10px --pad-x`）
- 头部：`ChartColumn` 15px +“时段分布”（`--fs-sm --fw-strong`）+ 副标“24 小时 · 按统计时区”；右侧为“峰值 HH:00 · 值”。
- 24 根柱，容器高 `--hourly-h` 52px，`gap 3px`，底边 `--line-strong`，柱顶圆角 `--r-xs`。普通柱 `--chart-ink`，峰值柱 `--signal`，低于峰值 1% 的柱固定 2px 高、颜色 `--empty`。坐标轴 `00 06 12 18 24`。

**C. 用量拆分** `.dcard.split`（占满剩余高度 `flex: 1 1 0`，内容区 `.dcard-body` 内部滚动；它是 `tabIndex=0` 的 `role="region"`，可用 Tab 聚焦后用方向键 / PageUp / PageDown 滚动）
- 头部：`ChartPie` +“用量拆分”。右侧文字按钮“查看当日会话 ↗” / “查看所选日期会话 ↗”，点击后卡片原地切换为会话列表（最多 50 条），再点“返回用量拆分”回来。
- 两段：“按 Agent”和“按模型”，段间距 `--sp-3`。每段有段标题（左侧名称，右侧“N 个”）和列头。
- 列头与行使用同一 grid：`minmax(0, 1fr) 64px 82px 52px`（名称 / Tokens / 参考费用 / 占比），列头为 `--fs-xs --ink-3`，右对齐，底边 `--line`。
- 每行 `.srow`（`padding 8px 0 7px`，`gap 5px`，底边 `--line`）分三层：
  1. 主行 `--fs-sm`：名称（Agent 前有 8px 色块；模型名用 Geist Mono，超长省略）、Tokens（`--fw-medium`）、费用（`CostValue`，含“部分未定价”表现）、占比（1 位小数，`--ink-3`）。
  2. 占比条：高 6px，`--r-pill`，底色 `--empty`；Agent 用 `--agent`，模型用 `--chart-ink`。
  3. 辅助行 `--fs-xs --ink-3`：Agent 为“缓存读 {pct} · {n} 次请求”，模型为“缓存读 {pct} · 输出 {output} · 每百万 {rate}”。
- 按 Tokens 从大到小排列。同名模型跨 Agent 合并（`mergedModelRows`），悬停名称时列出“使用的 Agent：…”。

### 5.9 导出

日历导出 `.report` 时，只导出滚动区内可见的月份块（`data-export-clip=".mblock"`）和详情栏。导出时月标题取消吸顶，滚动区展开，并附上页脚。缩放、回到今天、前后一天、清除选择、会话切换和底部提示都不进入导出。

---

## 6. 价格

### 6.1 结构

- 内容区 `.prices-content`：`padding --sp-6 --sp-6 0`，`gap --sp-4`，固定高度。上面是**不随内容滚动的头部面板**，下面是**分区滚动区**（`.price-scroll`：`overflow-y: auto`，分区间距 `--sp-6`，`padding-bottom --sp-6`）。
- ≤760px：整页滚动，分区头吸附在顶栏和横向导航下方。

### 6.2 头部面板 `.price-head.plate`（`padding --sp-3 --pad-x`，两行，行距 `--sp-3`）

- **第 1 行左侧**
  - 搜索框 `.price-search`：300 × `--ctl-sm`（28px），1px `--line-strong`，`--r-1`，`Search` 15px，占位文字“搜索模型或目录 ID”。聚焦时边框变为 `--ink`。按空格分词，每个词都要命中。匹配范围包括目录名、`modelId`、厂商、端点、别名和日志侧名称（`usedAs`）。≤700px 时宽 100%。
  - 开关“只看用过的模型”（`<button role="switch" aria-checked>`）：轨道 `--switch-w` × `--switch-h`（30×18），关时 `--line-strong`，开时 `--signal`；滑块 14px，`--surface-raised` + `--shadow-thumb`，位移过渡 `--dur-2`。**默认打开**。没有任何用过的模型时隐藏开关，直接显示全部。切换开关时 chip 重置为“全部”。
- **第 1 行右侧**
  - 说明（`--fs-xs --ink-3`）：“美元 / 百万 tokens · * 缓存单价缺失，按输入单价估算 · 价格更新于 {time}”（`priceHeaderMeta`）。
  - sm `MenuButton`（`Settings2`，“来源与自动更新”）：浮层宽 420px，包含来源选择、自动更新复选框、离线 / 自动说明、警告与错误、各来源的更新时间。
- **第 2 行：厂商筛选 chips**（`.chips`，`gap 6px`，可换行，单选，`aria-pressed`）
  - 第一个是“全部 {n}”，之后每家厂商一个 chip：16px logo + 短名（全名中“ · ”之前的部分）+ 数量。
  - `.chip`：高 `--chip-h` 30px，`--r-pill`，`padding 0 10px`，`gap 7px`，背景 `--surface-2` + `inset 1px --line`，`--fs-sm --ink-2`。数量 `--fs-xs --fw-medium --ink-3`。悬停时背景 `--surface-3`。
  - 选中：背景 `--ink`，文字 `--bg`，数量 `opacity .7`。
  - 计数跟随开关：开关打开时只计用过的模型，也只列出有用过模型的厂商。
  - 点选 chip 后，滚动区回到顶部。

### 6.3 分区与排序

- 每家厂商一个分区。分区头 `.price-section-head`：`position: sticky; top: 0`，背景 `--bg`，`padding --sp-1 0 6px`，`gap 10px`。内容为 22px logo、名称 `h3`（`--fs-lg --fw-strong`）、“{n} 个模型 · {m} 个用过”（`--fs-xs --ink-3`；m = 0 或开关打开时省略后半句）。
- 分区顺序：有用过模型的厂商在前，其余按显示名 `localeCompare` 排序。卡片顺序：用过的在前，其余按名称排序。
- 网格 `.mgrid`：`repeat(auto-fill, minmax(min(var(--price-card-min), 100%), 1fr))`，`gap --sp-3`，`align-items: start`。1440 宽时每行 3 张。
- **“5 张 + 查看全部”**：开关关闭、没有搜索词、chip 为“全部”时，每个分区只显示前 5 张卡；超过 5 张时，第 6 格放一张虚框卡 `.more-tile`（`inset 1px --line-strong`，`--r-2`，最小高 128px，居中显示 `Layers3` +“查看全部 {n} 个”+“还有 {n−5} 个 {厂商} 模型”）。点击后切换到该厂商的 chip，并回到顶部。其他情况一律显示全部匹配卡片。没有分页。
- 开关打开时，滚动区末尾显示一行说明：已显示用过的 N / 总数个模型。

### 6.4 模型卡片 `article.mcard`

- 背景 `--surface`，`--r-2`，`padding 14px`，竖向 `gap --sp-3`。悬停或展开时加 `inset 0 0 0 1px --line-strong`。用 `aria-labelledby` 指向模型名。
- **头部** `.chead`
  - 左侧 logo 方块 `.plogo--lg`：`--logo-tile` 40×40，`padding --sp-2`，`--r-2`，`--surface-2` 底 + `inset 1px --line`。
  - 右侧两行：模型名（Geist Mono，`--fs-sm --fw-medium`，超长省略，`title` 为全名）；厂商名（`--fs-xs --ink-3`）+ 徽标“用过”（`badge--signal`）、“{n} 个 ID”（目录 ID 多于 1 个时）、“保留的已知价格”（`badge--warn`，`official.retained`）。
  - 没有长上下文分档的卡片，右上角有一个 sm ghost IconButton（`ChevronDown`，“价格明细”），用来展开明细。
- **价格格** `.pgrid`：4 列（输入 / 输出 / 缓存读 / 缓存写），`--surface-2` 底，`--r-1`。
  - 每格 `.pcell`：`padding --sp-2 10px`，格之间 `inset 1px 0 0 --line`。
  - 标签 `--fs-xs --ink-3`，**单行显示，放不下时省略**（`white-space: nowrap; text-overflow: ellipsis`，`title` 为全称）。英文“缓存写”用短标签 `Cache wr.`（`priceCacheWriteShort`）。
  - 数值 `--fs-base --fw-strong --track-tight`，不换行。“只看用过的模型”视图中，主价格格数值放大到 `--fs-xl`。
  - 估算值后加上标 `*`（`--fs-xs --signal-ink`，`title` 为 `priceCacheFallback`）。
- **价格格式**（`fmtUnitPrice`，美元 / 百万 tokens）：至少 2 位小数，必要时扩到最多 4 位，例如 `$10.00`、`$0.275`、`$15.625`、`$0.0375`。0 显示 `$0`，极小值显示 `<$0.0001`，缺失显示 `—`。
- **长上下文胶囊** `.tier-pill`（只在有 `contextTiers` 时显示）：高 26px，`--r-pill`，`inset 1px --line-strong`，`padding 0 6px 0 --sp-2`，`gap 5px`，`--fs-xs --ink-2`。内容为 `Layers3` 14px +“长上下文 > 272K”（多档时为“长上下文 > 32K 等 3 档”）+ `ChevronDown`。展开后背景 `--surface-3`，箭头旋转 180°。带 `aria-expanded` 和 `aria-controls`。
- **展开区** `.cmore`（顶部 1px 虚线 `--line-strong`，`padding-top 10px`，`gap 10px`），依次为：
  1. 每个分档：标题“输入上下文（含缓存）超过 {n} tokens”（`inclusive` 时为“至少”），下面是 4 列价格格。分档的格为透明底 + `inset 1px --line`，数值用 `--fw-medium`。
  2. 其他条件（`Conditions`）：未确认的长上下文阈值、1 小时缓存写入单价、时段 / 星期规则。
  3. 目录 ID（code chip：`--surface-3` 底、`--r-sm`、等宽 `--fs-xs`）、“匹配别名”（目录别名 + 日志侧名称）、端点；合并行附说明。
  4. 末行：左侧为来源 · 最大输入 / 上下文窗口（有数据时），右侧为“价格来源 ↗”（`--signal-ink`，只接受 https 链接）。
- 多张卡可以同时展开，展开状态不持久化，默认全部收起。
- **全程不显示任何花费或用量。**

### 6.5 厂商 Logo

- 来源：LobeHub Icons（`@lobehub/icons-static-svg`，MIT）。文件在 `frontend/public/logos/`，同目录附 `LICENSE.txt` 和 `SOURCE.md`。品牌标识归各自所有者。
- 对应关系（`lib/prices.js` 的 `PROVIDERS`）：openai、anthropic、moonshot、zai、xai、ai21 为单色；google、deepseek、alibaba（qwen）、mistral、minimax、cohere 为彩色。卡片优先用模型家族 logo：`claude*` → claude-color，`gemini*` → gemini-color，`kimi*` → kimi-color，`grok*` → grok（单色）。
- 渲染（`ProviderLogo`）：彩色用 `<img alt="">`；**单色用 CSS mask + `background-color: currentColor`**，颜色为 `--ink`，跟随明暗主题。未知厂商用 `--surface-3` 底的首字母方块。尺寸：sm 16px（chip）、md 22px（分区头）、lg `--logo-tile`（卡片）。
- Logo 全部是装饰，`aria-hidden`，名称总是以文字出现。

### 6.6 重置与更新

“重置价格库”和“更新单价”在顶栏。重置使用模态 `dialog`（`.dialog`：宽 `min(520px, 100% − 32px)`、`--surface-raised`、`--shadow-pop`、`--scrim` 背景），对话框内提示可以先在设置中导出数据库备份。离线时禁用联网更新。

---

## 7. 设置

- `.settings-content`：竖向 `gap --gutter`，最大宽 1000px。三个面板（`Panel level={2}`，18px 图标）：
  1. **外观**：配色（浅色 / 深色 / 跟随系统，带图标的 `Segmented`）、界面语言（简体中文 / English）。
  2. **统计时区**：`select`（自动 = 系统时区，或任选 IANA 时区），下方显示当前时间预览（`--surface-2` 小块）和说明。
  3. **数据库**：导出 SQLite 备份、导入合并（文件选择 → 导入对话框：说明范围、显示文件名与大小，可以取消，出错后可以重试）。
  4. **GitHub 备份**（`CloudUpload`）：`.settings-body` 内一行两个 `Field`（私有仓库、密码型访问令牌，`flex 1 1 240px`，窄屏换行）加 secondary 保存按钮，下方 `muted-note` 说明令牌范围与存放位置，已保存令牌时附文字按钮“清除已保存的令牌”；环境变量提供令牌时输入框禁用并注明变量名。之后两行 `settings-row`：“上次备份”（右侧时间 · 大小，`--fs-sm --ink-2`；说明行为等宽的 `owner/repo · toksight/usage.sqlite`）和“备份与恢复”（`CloudUpload` 上传、`CloudDownload` 恢复两个 secondary 按钮；未配置、仓库输入未保存、离线启动或其他操作进行中时禁用，进行中显示旋转图标与“正在上传… / 正在恢复…”）。失败时在面板底部显示 `.notice`（标题“操作未完成”+ 本地化原因）。恢复先打开确认 `dialog`（同导入对话框：仓库与远端路径、合并说明、本机安全副本路径、取消 / “下载并合并”），恢复中的错误显示在对话框内，可重试。成功结果用 toast。
- 设置行 `.settings-row`：左侧标题 `--fs-sm --fw-medium` + 说明 `--fs-xs --ink-3`，右侧控件，行之间用 `--line` 分隔。
- 顶栏只有刷新按钮。

---

## 8. 组件约定

| 原语 | 组件 / 类 | 规则 |
| --- | --- | --- |
| Button | `Button`、`.btn` | 用于文字按钮。变体 `primary`（`--ink` 底反白）/ `secondary`（`--surface` 底 + `--line-strong` 描边）/ `ghost` / `text`（`--fs-xs --ink-2`，悬停变 `--signal-ink` 并加下划线）/ `danger`。尺寸 md `--ctl-md`、sm `--ctl-sm`。`loading` 时显示旋转图标并禁用，禁用时 `opacity .45` |
| IconButton | `IconButton`、`IconLink`、`.icon-btn` | 见 §8.1 |
| MenuButton | `MenuButton`、`.menu-panel` | IconButton 外观的 `<details>`，打开 `--surface-raised` + `--shadow-pop` + `--r-2` 的浮层（最小宽 190px，`padding --sp-3`）。点击外部、焦点离开或 Esc 时关闭，Esc 会把焦点还给按钮。打开期间不显示按钮提示 |
| Segmented | `Segmented`、`.seg` | 唯一的单选分段控件（配色、语言、图表指标）。`--surface-3` 轨道，`padding 2px`，选中滑块 `--surface-raised` + `--shadow-thumb` + `--fw-medium`。`radiogroup`，方向键 / Home / End，只有一个 Tab 停点 |
| Panel | `Panel`、`.plate` | 无外框的 `--surface` 色块，`--r-2`。头部 `.plate-head`（最小高 44px）：图标 + 标题、可选行内副标 `sub`、说明 `note`、计数徽标、操作。`plate--inset` 为 `--surface-2` 嵌入底 |
| Stat | `Stat`、`.readout` | 标签（含图标）/ 数值 / 差值 / 一行说明。一组指标是同一面板内用竖线分隔的一行 |
| Table | `.ledger` | `--fs-sm`，数字右对齐、不换行；表头 `--line-strong` 单线；行线 `--line`；悬停 `--surface-2`；可排序表头 `.sort-btn` |
| Field | `Field`、`input`、`select` | 高 `--ctl-md`，`--r-1`，`--line-strong` 边，悬停边框变 `--ink-3`。复选框 16px，选中为 `--ink` 底 + 3px 内衬 |
| Badge | `Badge`、`.badge` | 高 22px，`--r-pill`，`--fs-xs --fw-medium`；`neutral`（`--surface-3`）/ `signal`（`--signal-soft` + `--signal-ink`）/ `warn` |
| Chip | `.chip` | 只在价格页使用的筛选 chip，见 §6.2。用 `aria-pressed` 表示选中 |
| Switch | `.switch` | `role="switch"` + `aria-checked`，见 §6.2 |
| Meter | `Meter`、`.meter` | 8px 高，`--r-pill`，`--empty` 轨道，`--ink` 填充，≥80% 改用 `--signal`，`role="meter"` |
| Swatch | `.swatch`、`.agent-dot` | 8×8px，圆角 2px：Agent 色、Token 构成色、图例 |
| Notice / Toast | `.notice`、`.toast` | 左侧 3px 语义色条。toast 位于底部居中，`--surface-raised` + `--shadow-pop` |

### 8.1 IconButton

- 唯一的纯图标按钮，用于顶栏全部操作、日历工具、前后一天、侧栏收起、价格来源设置和卡片明细。
- **md**：`--ctl-md` 34×34，`--r-1`，**背景 `--surface`**，图标 17px、stroke 1.6、颜色 `--ink-2`。
- **sm**：`--ctl-sm` 28×28，图标 16px。
- **ghost**：背景透明（侧栏收起、卡片明细）。
- 悬停：背景 `--surface-3`，颜色 `--ink`，过渡 `--dur-1 --ease`。禁用：`opacity .4`。进行中：图标换成 `LoaderCircle .spin`，同时设 `aria-busy`。
- `label` 同时是 `aria-label` 和按钮提示，不使用原生 `title`。可选 `shortcut` 在提示里追加 `<small>`（`--ink-3`）。

### 8.2 提示（Tooltip）

- **按钮提示** `AnchorTip` / `useButtonTip`（`.btn-tip`）：悬停或键盘聚焦（`:focus-visible`）300ms 后出现，位置在控件下方 6px、右对齐；靠近视口底部时翻到上方，并保持在视口 8px 以内。样式为 `--surface-raised` + `--shadow-pop` + `--r-1`，`padding 6px 10px`，`--fs-xs`。按下指针、失焦、Esc、滚动、滚轮、窗口缩放时隐藏。
- **数据提示** `Tooltip` / `useTip`（`.tooltip`）：反色标签（`--ink` 底、`--ink-inverse` 字），`--r-1`，`--shadow-pop`，最大宽 360px。通过 portal 渲染到 `body`，距指针 14px，在视口内翻转。内容由 `TipTitle`（`--fs-sm --fw-strong`，可用等宽）和 `TipRow`（点引线“标签 ······ 值”）组成。
  - 指针和焦点都能触发（`atElement`）。显示期间，任一祖先或窗口滚动、滚轮或窗口缩放都会隐藏提示；但锚定在当前焦点元素上的提示，只要元素仍在滚动容器可见区内，就随元素移动（键盘导航滚动时提示不消失）。
  - 日历拖动期间不显示提示。
- 提示通过 portal 渲染，所以不会进入导出图片。

### 8.3 焦点

- 全局 `:focus-visible { outline: 2px solid --signal; outline-offset: 2px }`，所有可交互元素一致。
- 日历日格和周单元的焦点环改用 `--focus-offset-sel`（3px）。选中框（单选 offset 1px、多选 offset 0）始终在焦点环内侧；选中且聚焦时选中框改由 `box-shadow` 绘制，两者同时可见。
- 可滚动区域（详情栏“用量拆分”内容区）的焦点环用 `--focus-offset-inset` 画在区域内侧，不被卡片边缘裁掉。
- `::selection` 为 `--signal-soft` 底。

---

## 9. 无障碍与键盘

- **语义**：使用语义按钮、表格、字段标签、原生 `dialog`、`<details>` 菜单；每个图标按钮都有可访问名称。页面有“跳到内容”链接（`.skip-link`），`main` 可以聚焦；页名放在视觉隐藏的 `h1` 里。
- **日历网格**：每个月块是 `role="grid"`（`aria-label`“用量日历，2026年10月”），行是 `role="row"`，日格是 `gridcell` 里的 `<button>`。选中用 `aria-selected`，今天用 `aria-current="date"`，未来日用 `aria-disabled`。日格 `aria-label` 为“日期 周几 · tokens · 费用”，或“无活动” / “尚未到来”。周单元是按钮，`aria-label` 用 `calWeekAria`。
- **日历键盘**（roving tabindex，整个列表只有一个 Tab 停点）：

| 按键 | 作用 |
| --- | --- |
| ← → | ±1 天，可以跨月；大档时从一行最后一天按 → 进入该行的周单元，在周单元上按 ← 回到日格 |
| ↑ ↓ | ±7 天；在周单元上时移到上一行 / 下一行的周单元 |
| Home / End | 本周一 / 本周日 |
| PageUp / PageDown | ±1 个月（日期按月长截断） |
| Enter / 空格 | 单选当前日；在周单元上时选中整周（加 Ctrl/⌘ 为追加） |
| Shift + 方向键 | 从锚点扩展区间 |
| Ctrl/⌘ + 空格 | 增减当前日 |
| `+` / `=`、`-` | 放大 / 缩小，以焦点日为锚点 |
| Esc | 回到只选今天 |

  焦点移出视口时自动滚动（顶部预留 40px，避开吸顶月标题），并在焦点元素旁显示数据提示。
- **详情栏**：标题 `aria-live="polite"`，选区变化时会读出。加载中 `aria-busy`。拆分卡是带 `aria-label` 的 `section`；其滚动内容区可以用 Tab 聚焦（`tabIndex=0`、`role="region"`，`aria-label` 为 `splitRegion`“用量拆分明细（可滚动）”，会话视图为 `sessionsRegion`），聚焦后用方向键、PageUp / PageDown、Home / End 滚动，并显示内侧焦点环。
- **价格页**：开关为 `role="switch"`；chips 是 `role="group"` 里的 `aria-pressed` 按钮；分档按钮和明细按钮带 `aria-expanded` / `aria-controls`；“查看全部”虚框卡是 `<button>`；卡片是带 `aria-labelledby` 的 `article`。
- **图表**：时段柱可以聚焦并带 `aria-label`；堆叠条和时段条用 `role="img"` 加完整文字描述。热图、额度和占比不只靠颜色表达，数值文字始终可见；heat-3/4 上的文字用 `--heat-ink-hi`。
- **其他**：分段控件支持方向键 / Home / End；菜单和对话框按 Esc 关闭并归还焦点；尊重 `prefers-reduced-motion`；最小字号 13px。
- **状态**：首次引导、空数据、加载、网络错误（可重试）、部分未定价、禁用、离线和操作进度都有明确状态。加载或失败时标注所显示数据的日期与时区。数据未就绪时禁止导出。

---

## 10. 文案与 i18n 约定

- 文案集中在 `frontend/lib/i18n.js`，`zh-CN`（默认）和 `en` 两份必须同步新增和删除。缺失时依次回退到 `zh-CN` 和 `en`。语言偏好持久化（`toksight-locale`）。
- 插值使用 `{name}` 占位，例如 `calHint` 的 `{mod}`（Ctrl / ⌘）、`priceViewAll` 的 `{n}`。数字统一经 `fmtInt` / `fmtTokens` / `fmtCost` / `fmtPct` 格式化后再插入。
- 中文为句首无大小写的短句；英文用句首大写（sentence case），不全大写。
- 中文数字与单位之间按现有文案处理（“{n} 个模型”“已选 {n} 天”）；“Tokens”“Agent”“ID”保持英文。
- 窄格标签要短，并且**单行省略**。必要时提供短 key，例如 `priceCacheWriteShort`（`缓存写` / `Cache wr.`）；完整说法放进 `title`。
- 日期与周：中文月标题“2026年10月”，英文用 `periodLabel`；周号 `W{n}` / `{yy}W{n}`；整周标题“{year} 年 W{n}” / “{year} W{n}”。
- 厂商名：全名用于分区标题（例如“Moonshot AI · Kimi”“Z.ai · 智谱 GLM”“阿里云 · 通义千问”，英文为“Z.ai · Zhipu GLM”“Alibaba · Qwen”），chip 只用“ · ”之前的短名。
- 费用一律叫“参考费用”（estimated cost），表示这是依据公开单价的估算。

---

## 11. 不做的事

- 不使用第二种字体、衬线体、全大写标签或额外字距；不出现小于 13px 的文字。
- 不新增 `tokens.css` 之外的颜色；不加渐变、纹理、网格底、面板外框或面板投影。
- 顶栏不放产品名、页面标题或文字按钮；页面操作不分主次按钮；不用原生 `title` 代替按钮提示。
- 页面不设大标题、眉标或介绍行；侧栏不放“个人工作台”卡片。
- 概览不加 Agent 筛选条，也不另设独立的模型用量表。
- 日历不加按月 / 按年切换或翻月按钮，不加 Agent 筛选；周单元不参与热度着色；未来日不可选；多选时不显示时段条。
- 价格页不显示任何花费或用量，不分页，不用表格展示目录。
- 不引入动画库或第二个图标库（图标只用 `lucide-react`）。前端依赖只放 `frontend/package.json`，根包保持零运行时依赖。
- 不写 Agent 配置；Web 界面只读取 toksight 自己的数据。
