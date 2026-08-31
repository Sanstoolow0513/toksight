# toksight Design Specification

> v2（2026-08）：视觉语言从 GitHub 深色迁移到 **Vercel 纯黑极简风**。布局、信息层级、图标系统以本文件为准。

## 1. Design direction

- **Product**: 本地优先的 AI coding agent token 用量仪表盘（`toksight web`）。数据只读本地会话文件，不出机器。
- **Style family**: Vercel Dashboard 式纯黑极简 —— 纯黑底、细描边、无阴影、大数字 KPI、信息层级靠字号与灰阶而非色块。
- **Tone**: 本地、克制、数据优先。
- **Hard constraints**: 只出深色；中英可切；根 CLI 零运行时依赖（dashboard 依赖只允许在 `web/`，构建期）；
  原生 CSS（无 Tailwind / 组件库）；Windows 路径与中文 UI 必须可用。
- **Locale**: primary `zh-CN`，secondary `en`，整页切换，localStorage `toksight-locale`。

## 2. Color

Pure-black neutrals + 单一品牌蓝。

### Brand

- `--color-primary`: `#3291ff` — 链接、选中、主图表序列、logo 句点
- `--color-primary-hover`: `#5ea8ff`
- `--color-primary-subtle`: `rgba(50, 145, 255, 0.14)` — 分段选中底、筛选提示底

### Neutrals

- `--color-bg`: `#000000` — 页面底（纯黑）
- `--color-surface`: `#0a0a0a` — 卡片 / 面板
- `--color-surface-subtle`: `#111111` — 分段轨道、进度条槽、code 底、骨架块
- `--color-border`: `#262626` — 卡片描边、表行线
- `--color-border-strong`: `#3d3d3d` — 表头底线、按钮描边、浮层描边
- `--color-text`: `#ededed`
- `--color-text-secondary`: `#a1a1a1`
- `--color-text-muted`: `#666666` — 轴标签、图例弱化

### Semantic

- `--color-success`: `#45d483` — 缓存命中率、缓存读取序列、live 指示点
- `--color-warning`: `#f5a524`
- `--color-error`: `#ff4d4d`

### Charts

Token 四类：`input #3291ff` / `cache-read #45d483` / `cache-write #bc8cff` / `output #f5a524`。

热力图 5 档（纯黑校准）：`#161616` / `#0a2a52` / `#0d4a9e` / `#1f6feb` / `#7ab8ff`。

分类色 `--color-cat-1..8`：`#3291ff #45d483 #f5a524 #bc8cff #f778ba #39c5cf #ff4d4d #8ddb8c`，
与 `web/lib/palette.js` 一一对应；同一实体在 donut、条、表里必须同色。

### Dark mode

只出深色，无浅色 override。

## 3. Typography

- **Geist Sans / Geist Mono**：通过 `geist` npm 包 + `next/font` 本地打包（运行时不联网），
  CSS 变量 `--font-geist-sans` / `--font-geist-mono`，回退 system-ui / ui-monospace。
- Logo、模型名、session id、路径、code 用 mono。
- Type scale (px)：`12 / 14 / 16 / 18 / 24 / 30`（30 为 KPI 大数字）。
- 标题 `letter-spacing: -0.01em ~ -0.02em`；数字 `tabular-nums`；正文 `line-height: 1.7`。

## 4. Spacing / Radius / Elevation / Motion

- Spacing base 4px：`4 / 8 / 12 / 16 / 24 / 32 / 48`；卡片 padding 24px；栅格 gap 16px；内容最大宽 1200px。
- Radius：`sm 6px`（热力格、色点、进度条）/ `md 8px`（按钮、分段、tooltip）/ `lg 12px`（卡片）。
  `--radius-full` 只允许用于 live 指示点小圆点与 live badge。
- Elevation：平。容器靠描边；`--shadow-lg` 仅 tooltip / 浮层。
- Motion：≤150ms ease，仅颜色/透明度；例外：刷新图标的旋转（loading 指示）与骨架屏脉冲（opacity）。

## 5. Icon system

- **Set**: `lucide-react`（`web/` 构建期依赖）。统一 `strokeWidth={2}`，尺寸 14–18px。
- 用途限定：导航操作（RefreshCw）、KPI 卡角标、次级指标、区块标题、警告/筛选条、空/错误态。
- 图例与模型行仍用 8px 色点，不用图标。

## 6. Layout / information hierarchy

1. **吸顶导航** `.topnav`：`sticky` + `backdrop-filter: blur` + 半透明黑底；左 logo + live badge（绿点），
   右语言分段、自动刷新 checkbox、刷新按钮。
2. **副标题行**：产品一句话 + 时区。
3. 警告条 / 筛选提示条（图标 + 语义色描边）。
4. **KPI 主行** `.kpi-grid`：4 张大卡 —— 累计 Tokens（Zap）、总费用（CircleDollarSign）、
   缓存命中率（Database，绿色强调）、活跃天数（CalendarDays）。30px 大数字 + 副文案。
5. **次级指标条** `.substats`：单卡单行 —— 连续活跃（Flame）、峰值日（TrendingUp）、最长会话（Timer）。
6. 区块顺序：热力图（Activity）→ 趋势（TrendingUp，7/30/90 seg）→ 时间范围（CalendarRange）| Agent donut（PieChart）→
   小时（Clock）| 月份（BarChart3）→ 模型用量（Layers，含 Agent×模型 明细折叠表）→ Agent 命中率（Gauge）→
   会话 Top（ListOrdered）→ 页脚。
   Agent 命中率区：顶部 seg 切换（「全部」+ 各 Agent，Agent 标签带与其 donut 同色的 8px 色点）；
   「全部」为绝对 0–100% 刻度的绿色对比条（`.mrow-bar` 复用，点击条目钻取）；单 Agent 视图
   为 24px 绿色大数字 + 副文案（缓存读 / 新输入 / 请求），下方该 Agent 的分模型命中率条，
   命中率 `—` 时条宽为 0。命中率统计按每次请求归因（session 切模型会被拆分归入各模型，不误计）。
7. 双栏 `1.4fr / 1fr`，≤960px 单列；KPI ≤960px 两列、≤560px 单列。

## 7. States

- **Loading**：骨架屏（`.skel` 脉冲，仅 opacity 动画），不再用一行「加载中…」。
- **Empty**：单卡 + Inbox 图标 + `toksight env` / `--client` / `--since` 提示。
- **Error**：单卡 + TriangleAlert 图标 + 失败原因与下一步 + 重试按钮。

## 8. Anti-patterns

- 不要浅色主题；不要卡片阴影；不要图标以外的装饰插画 / 背景纹理 / 渐变（渐变只留进度条）。
- 不要卡片嵌套；不要把 Inter 等其他字体当升级（本项目用 Geist）。
- 不要把未定价模型藏掉——页脚或费用副文案必须可见。
- 不要用 UTC 日期；日界与筛选跟本机本地时区。
- 同一 Agent/模型在不同图里换颜色。
- 中文界面夹未翻译的 chrome。

## 9. Open questions

- 明暗双主题：用户暂不需要；如未来要做，所有颜色已是 CSS 变量，加一套 `:root[data-theme=light]` override 即可。
