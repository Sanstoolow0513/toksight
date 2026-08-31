# toksight Design Specification

> v3（2026-08）：从固定 1200px 宽的分区滚动页迁移到**流式卡片布局 + 动效系统**。
> 信息密度重排：KPI 大卡片与次级指标条并入活动卡片的统计条；时间范围表并入趋势卡片；
> Agent 环形图与命中率卡合并；会话 Top 表移除；模型条内嵌缓存占比分段。
> 布局、信息层级、动效、图标系统以本文件为准。

## 1. Design direction

- **Product**: 本地优先的 AI coding agent token 用量仪表盘（`toksight web`）。数据只读本地会话文件，不出机器。
- **Style family**: Vercel Dashboard 式纯黑极简 + 克制的动效层 —— 纯黑底、细描边、无阴影、
  卡片交错入场、数字滚动、图表擦揭示。
- **Tone**: 本地、克制、数据优先；动效服务层级感知，不为炫技。
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

- `--color-success`: `#45d483` — 缓存命中率、缓存读取序列、live 指示点、模型条中的缓存分段
- `--color-warning`: `#f5a524` / `--color-error`: `#ff4d4d`

### Charts

Token 四类：`input #3291ff` / `cache-read #45d483` / `cache-write #bc8cff` / `output #f5a524`。

热力图 5 档（纯黑校准）：`#161616` / `#0a2a52` / `#0d4a9e` / `#1f6feb` / `#7ab8ff`。

分类色 `--color-cat-1..8`：`#3291ff #45d483 #f5a524 #bc8cff #f778ba #39c5cf #ff4d4d #8ddb8c`，
与 `web/lib/palette.js` 一一对应；同一实体在趋势 Agent 模式、Agent 份额条、展开明细里必须同色
（Agent 按份额降序取色，两个视图使用同一顺序）。

### Ambient

唯一允许的装饰渐变：页面顶部一道极淡的品牌蓝 radial glow（`body` 背景，约 9% 透明度），
呼应 hero 卡片；不得再加任何背景纹理 / 光斑。

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
- **Motion（v3 核心）**：全部动效走 `--ease-out: cubic-bezier(.22,1,.36,1)`，且
  `prefers-reduced-motion: reduce` 下一律关闭（JS 的数字滚动同样监听该媒体查询）。
  - 卡片入场：`card-in`（opacity + 14px 上移 + 轻微 scale），按 `--i` 每卡错峰 90ms；
  - 数字滚动：hero 统计 chip 数值 `useCountUp`（easeOutCubic ~900ms）；
  - 热力格：`heat-in`（scale .4 → 1）按列错峰 ~9ms/列，hover 放大 1.35；
  - 趋势图：`wipe-x` clipPath 从左向右揭示（0.9s），切换范围/模式/序列时重放；
  - 条形：`grow-x` / `grow-y`（origin left/bottom），小时/月份柱按索引错峰；
  - live 指示点：绿色 `live-ping` 呼吸（2.2s 循环）；
  - Agent 行展开：`grid-template-rows 0fr → 1fr` 高度过渡（0.3s）；
  - 微交互：卡片 hover 描边提亮、bar hover 增亮、分段/图例 hover 变色，均 ≤150ms。
  - 保留 v2 例外：刷新图标旋转、骨架屏脉冲。

## 5. Icon system

- **Set**: `lucide-react`（`web/` 构建期依赖）。统一 `strokeWidth={2}`，尺寸 14–18px。
- 用途限定：导航操作（RefreshCw）、统计 chip 角标、区块标题、警告/筛选条、空/错误态、
  Agent 行展开箭头（ChevronDown，展开时旋转 180°）。
- 图例与模型行仍用 8px 色点，不用图标。

## 6. Layout / information hierarchy

1. **吸顶导航** `.topnav`：`sticky` + `backdrop-filter: blur` + 半透明黑底；左 logo + live badge（绿点），
   右语言分段、自动刷新 checkbox、刷新按钮。**v3 移除副标题行**（产品一句话与时区；
   时区挪到页脚 `footTimezone`）。
2. 警告条 / 筛选提示条（图标 + 语义色描边）。
3. **活动卡片**（span 全宽）：统计条 `.statstrip`（auto-fit ≥168px 的 chip 网格：累计 Tokens、
   总费用、缓存命中率（绿色强调）、活跃天数、连续活跃、峰值日、最长会话（活跃时长，
   副行标注壁钟跨度））+ GitHub 风格热力图 + 少/多图例。
4. **趋势卡片**（span 全宽）：头部右侧为今日 / 近 7 天 / 近 30 天 / 本月汇总胶囊
   （label + tokens + cost，取代旧时间范围表）；控制行 = 范围分段（7/30/90）× 维度分段
   （构成 / Agent）；可点击图例 chip 开关序列（至少保留一个）；合计 tokens 与费用常驻右上。
   Agent 模式与 Agent 份额卡共用调色顺序。
5. **双栏**（≤1080px 单列）：Agent 分布卡（份额条 max 相对宽 + tokens/费用/占比 +
   绿色命中率细条 + 点击行展开分模型命中明细 + 合计行）｜模型用量卡（跨 Agent 聚合排行，
   条内 `linear-gradient` 硬分段：绿色缓存读取段 + 模型色的其余流量段，绿色"缓存 N%"徽标，
   底部两色图例；Agent × 模型明细折叠表保留）。
6. **双栏**：按小时直方图（当地时间）｜按月直方图（全历史）。
7. **页脚**：时区、统计范围、生成时间、未定价模型、版本与 local-first 声明。
8. **v3 移除**：四张 KPI 大卡、次级指标条、时间范围表、Agent 环形图独立卡、
   Agent 命中率独立卡（tab 切换）、会话 Top 表（API 保留 `topSessions` 供兼容）。
   命中率统计按每次请求归因（session 切模型会被拆分归入各模型，不误计）。
9. **最长会话语义**：按 `activeMs`（请求间隔 5 分钟封口）排名，壁钟跨度 `durationMs`
   只作副行标注——挂机过夜的会话不再虚增时长。

## 7. States

- **Loading**：骨架屏（`.skel` 脉冲，仅 opacity 动画），形状对齐新布局（活动卡 + 趋势卡两块）。
- **Empty**：单卡 + Inbox 图标 + `toksight env` / `--client` / `--since` 提示。
- **Error**：单卡 + TriangleAlert 图标 + 失败原因与下一步 + 重试按钮。

## 8. Anti-patterns

- 不要浅色主题；不要卡片阴影；除顶部 ambient glow 与进度条渐变外不要装饰性渐变。
- 不要回归固定 1200px 内容宽；不要复活 KPI 大卡墙 / 会话 Top 表。
- 不要在动效里忽略 `prefers-reduced-motion`。
- 不要把 Inter 等其他字体当升级（本项目用 Geist）。
- 不要把未定价模型藏掉——页脚必须可见。
- 不要用 UTC 日期；日界与筛选跟本机本地时区。
- 同一 Agent/模型在不同图里换颜色。
- 中文界面夹未翻译的 chrome。

## 9. Open questions

- 明暗双主题：用户暂不需要；如未来要做，所有颜色已是 CSS 变量，加一套 `:root[data-theme=light]` override 即可。
