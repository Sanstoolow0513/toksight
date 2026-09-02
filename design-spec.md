# toksight Design Specification

> v4（2026-09）：在 v3 流式布局上做"去模板味"收敛——装饰性图标全删（图标只留操作与
> 状态）；入场动效整体撤销，动效只作交互反馈；移除顶部 ambient glow 与"实时"徽标
> （改为上次抓取时间）；分类色收敛为品牌蓝 + 灰阶名次色；活动/趋势两张主卡之后的
> 次要区块降为无框 block；区块 desc 只保留真实信息。v3 的信息密度重排全部保留。
> 布局、信息层级、动效、图标系统以本文件为准。

## 1. Design direction

- **Product**: 本地优先的 AI coding agent token 用量仪表盘（`toksight web`）。数据只读本地会话文件，不出机器。
- **Style family**: 纯黑极简数据面板 —— 纯黑底、细描边、无阴影；活动/趋势两张主卡承载
  视觉重心，其后次要统计为无框区块。不做"模板感"装饰：无 ambient 光晕、无彩虹分类色、
  无装饰性图标。
- **Tone**: 本地、克制、数据优先；动效只作交互反馈（悬停、展开、图表切换），无全页
  入场编排，数字与图表首屏即所见。
- **Hard constraints**: 只出深色；中英可切；根 CLI 零运行时依赖（dashboard 依赖只允许在 `web/`，构建期）；
  原生 CSS（无 Tailwind / 组件库）；Windows 路径与中文 UI 必须可用。
- **Locale**: primary `zh-CN`，secondary `en`，整页切换，localStorage `toksight-locale`。

## 2. Color

Pure-black neutrals + 单一品牌蓝（与 v2 一致，未改动）。

### Brand

- `--color-primary`: `#3291ff` — 链接、选中、主图表序列、logo 句点
- `--color-primary-hover`: `#5ea8ff`
- `--color-primary-subtle`: `rgba(50, 145, 255, 0.14)` — 分段选中底、筛选提示底

### Neutrals

- `--color-bg`: `#000000` — 页面底（纯黑）
- `--color-surface`: `#0a0a0a` — 卡片
- `--color-surface-subtle`: `#111111` — 统计 chip、分段轨道、进度条槽、code 底、骨架块
- `--color-border`: `#262626` — 卡片描边、表行线
- `--color-border-strong`: `#3d3d3d` — 表头底线、按钮描边、浮层描边
- `--color-text`: `#ededed`
- `--color-text-secondary`: `#a1a1a1`
- `--color-text-muted`: `#666666`

### Semantic

- `--color-success`: `#45d483` — 缓存命中率、缓存读取序列、模型条中的缓存分段
- `--color-warning`: `#f5a524` / `--color-error`: `#ff4d4d`

### Charts

Token 四类：`input #3291ff` / `cache-read #45d483` / `cache-write #bc8cff` / `output #f5a524`。

热力图 5 档（纯黑校准）：`#161616` / `#0a2a52` / `#0d4a9e` / `#1f6feb` / `#7ab8ff`。

分类色 `--color-cat-1..5`：`#3291ff #9a9a9a #6e6e6e #4c4c4c #2e2e2e`（品牌蓝 + 灰阶），
与 `web/lib/palette.js` 一一对应。**按名次取色**：份额/用量降序，第 1 名品牌蓝，其余依次
灰阶——颜色编码排名而非身份；趋势 Agent 模式与 Agent 份额条按同一排序取色，模型排行
条同理。

### Ambient

无。页面背景纯黑，不加 glow、纹理或光斑。

### Dark mode

只出深色，无浅色 override。

## 3. Typography

- **Geist Sans / Geist Mono**：通过 `geist` npm 包 + `next/font` 本地打包（运行时不联网），
  CSS 变量 `--font-geist-sans` / `--font-geist-mono`，回退 system-ui / ui-monospace。
- Logo、模型名、session id、路径、code 用 mono。
- Type scale (px)：`12 / 14 / 16 / 18 / 20(chip 数值) / 24`。v3 取消 30px KPI 大数字——
  数值层级收敛到统计 chip 的 20px。
- 标题 `letter-spacing: -0.01em ~ -0.02em`；数字 `tabular-nums`；正文 `line-height: 1.7`。

## 4. Spacing / Radius / Elevation / Motion

- Spacing base 4px：`4 / 8 / 12 / 16 / 24 / 32 / 48`；卡片 padding 24px；栅格 gap 16px。
- **页面流式宽度**：无固定内容宽。容器 `max-width: 1720px`（超宽屏的护栏而已）+ 
  `padding-inline: clamp(16px, 3.2vw, 56px)`，卡片随视口伸缩；图表用 ResizeObserver 自适应。
- Radius：`sm 6px` / `md 8px` / `lg 12px`（chip）/ `xl 16px`（卡片）。
- Elevation：平。容器靠描边；`--shadow-lg` 仅 tooltip / 浮层。
- **Motion（v4：只作交互反馈）**：全部动效走 `--ease-out: cubic-bezier(.22,1,.36,1)`，且
  `prefers-reduced-motion: reduce` 下一律关闭（CSS 全局 override）。
  - 允许：卡片/chip/分段/图例/表格行/柱的 hover 微交互（≤150ms）；Agent 行展开
    （`grid-template-rows 0fr → 1fr`，0.3s）与 caret 旋转；趋势图在**用户切换**
    范围/维度/序列时重放一次 450ms 擦揭示（首屏静态呈现）；刷新图标旋转；
    骨架屏脉冲；整页首次载入一次性 240ms 淡入。
  - 已删除、勿回归：卡片错峰入场、数字滚动（`useCountUp` 已移除）、热力格入场错峰、
    柱/条生长入场、live 呼吸点。

## 5. Icon system

- **Set**: `lucide-react`（`web/` 构建期依赖）。统一 `strokeWidth={2}`，尺寸 14–18px。
- 用途限定（v4 收缩）：**只用于操作与状态**——刷新按钮（RefreshCw，进行中旋转）、
  警告/筛选条、空/错误态、Agent 行展开箭头（ChevronDown，展开时旋转 180°）。
- 统计 chip 与区块/卡片标题**不带图标**；图例与模型行仍用 8px 色点，不用图标。

## 6. Layout / information hierarchy

1. **吸顶导航** `.topnav`：`sticky` + `backdrop-filter: blur` + 半透明黑底；左 logo + 上次
   抓取时间（纯文本、取 `generatedAt`，不宣称"实时"），右语言分段、自动刷新 checkbox、
   刷新按钮。**v3 移除副标题行**（产品一句话与时区；时区挪到页脚 `footTimezone`）。
2. 警告条 / 筛选提示条（图标 + 语义色描边）。
3. **活动卡片** `.card`（主卡，span 全宽）：统计条 `.statstrip`（auto-fit ≥168px 的 chip 网格：
   累计 Tokens、总费用、缓存命中率（绿色强调）、活跃天数、连续活跃、峰值日、最长会话
   （活跃时长，副行标注壁钟跨度））+ GitHub 风格热力图 + 少/多图例。
4. **趋势卡片** `.card`（主卡，span 全宽）：头部右侧为今日 / 近 7 天 / 近 30 天 / 本月汇总胶囊
   （label + tokens + cost，取代旧时间范围表）；控制行 = 范围分段（7/30/90）× 维度分段
   （构成 / Agent）；可点击图例 chip 开关序列（至少保留一个）；合计 tokens 与费用常驻右上。
   Agent 模式与 Agent 份额卡共用调色顺序。
5. **无框双栏** `.block`（≤1080px 单列）：Agent 分布区块（份额条 max 相对宽 + tokens/费用/
   占比 + 绿色命中率细条 + 点击行展开分模型命中明细 + 合计行；≤640px 隐藏费用/占比、
   保留 tokens）｜模型用量区块（跨 Agent 聚合排行，条内 `linear-gradient` 硬分段：绿色缓存
   读取段 + 模型色的其余流量段，绿色"缓存 N%"徽标，底部两色图例——"其余流量"图例点为
   双色硬分段、表示随名次取色；Agent × 模型明细折叠表保留）。
6. **无框双栏**：按小时直方图（当地时间）｜按月直方图（全历史）。小时轴标签绝对定位在
   各刻度柱心 `(h+0.5)/24`（不用 space-between）；柱状图 hover 用与热力图/趋势图同一套
   自绘 tooltip（`components/Tip.jsx`），不用原生 `title`。
7. **层级规则（v4）**：3、4 为 `.card` 主卡（h2 16px）；5、6 为 `.block` 无框区块（h3 14px
   次级标题、无背景/描边/padding），以一条 hairline（border-top）与更大留白同主卡区分。
   区块 desc 只写真实信息（如"当地时间"、"全部历史"），不写实现说明。
8. **页脚**：时区、统计范围、生成时间、未定价模型、版本与 local-first 声明。
9. **v3 移除**：四张 KPI 大卡、次级指标条、时间范围表、Agent 环形图独立卡、
   Agent 命中率独立卡（tab 切换）、会话 Top 表（API 保留 `topSessions` 供兼容）。
   命中率统计按每次请求归因（session 切模型会被拆分归入各模型，不误计）。
10. **最长会话语义**：按 `activeMs`（请求间隔 5 分钟封口）排名，壁钟跨度 `durationMs`
   只作副行标注——挂机过夜的会话不再虚增时长。

## 7. States

- **Loading**：骨架屏（`.skel` 脉冲，仅 opacity 动画），形状对齐新布局（活动卡 + 趋势卡两块）。
- **Empty**：单卡 + Inbox 图标 + `toksight env` / `--client` / `--since` 提示。
- **Error**：单卡 + TriangleAlert 图标 + 失败原因与下一步 + 重试按钮。

## 8. Anti-patterns

- 不要浅色主题；不要卡片阴影；除功能性硬分段（缓存占比、模型条双色图例）外不要
  装饰性渐变，也不要背景 glow / 纹理。
- 不要回归固定 1200px 内容宽；不要复活 KPI 大卡墙 / 会话 Top 表。
- 不要给统计 chip / 卡片与区块标题加装饰图标；图标只用于操作与状态。
- 不要全页入场动画编排（卡片错峰、数字滚动、逐格/逐柱生长）；动效只作交互反馈。
- 不要"实时"徽标或呼吸点——数据是每次请求时抓取的，导航栏用"上次抓取"时间表述。
- 分类色不要回到彩虹色板；蓝 + 灰阶是刻意的名次编码，不要给图例点单独配色。
- 不要在动效里忽略 `prefers-reduced-motion`。
- 不要把 Inter 等其他字体当升级（本项目用 Geist）。
- 不要把未定价模型藏掉——页脚必须可见。
- 不要用 UTC 日期；日界与筛选跟本机本地时区。
- 同一 Agent/模型在不同图里换颜色。
- 中文界面夹未翻译的 chrome。

## 9. Open questions

- 明暗双主题：用户暂不需要；如未来要做，所有颜色已是 CSS 变量，加一套 `:root[data-theme=light]` override 即可。
