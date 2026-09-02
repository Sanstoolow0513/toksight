# toksight Design Specification

> v6（2026-09）：推倒重来——视觉语言从"细腻暗色 SaaS"整体切换为 **Brutalism 磷光终端
> 工作表**。风格方向来自 ui-ux-pro-max（variance 8 / motion 3 / density 9），但 **施工图
> 以本文件为准**。`design-system/toksight/MASTER.md` 是本文件的投影（token / 组件 /
> 反模式），禁止用 skill `--persist` 的泛 SaaS 模板（圆角、阴影、200ms 过渡、Google
> Fonts）覆盖。整页是一张带 2px 外框的马赛克工作表，区块之间用 2px 硬网格线分割
> （gap + `--color-border-strong` 底色），方角、零圆角、零模糊、零阴影、零渐变；
> Geist Mono 主导数据排版；配色为 ANSI 磷光系（lime 品牌色 + green/cyan/magenta/amber
> 图表色）；交互反馈是"硬反转"（lime 底黑字），无平滑过渡。信息架构：masthead → 4 格
> KPI 条 → 12 列 Bento 工作表（趋势、热力图、Agent/模型、小时/月/节奏、会话表）。v6
> 恢复会话用量表（按 tokens 排名前 10，数据一直在 API 的 `topSessions` 里）。v4 的动效
> 纪律、图标纪律、名次取色原则保留（调色板换为 lime 主导）。
> 布局、信息层级、动效、图标系统以本文件为准。

## 1. Design direction

- **Product**: 本地优先的 AI coding agent token 用量仪表盘（`toksight web`）。数据只读本地会话文件，不出机器。
- **Style family**: Brutalism 磷光终端工作表——CLI 工具的可视化延伸。页面是一张工作表
  （`.frame`，2px 实线外框、最大宽 1680px、页面留白包裹），内部区块以 2px 硬网格线分割；
  结构靠边框而非表面色差；无圆角、无阴影、无模糊、无渐变、无光晕。对比度极高，密度高。
- **Tone**: 工具感、硬朗、数据优先；这是给人看的工作表，不是给客户演示的 SaaS 皮肤。
- **Hard constraints**: 只出深色；中英可切；根 CLI 零运行时依赖（dashboard 依赖只允许在
  `web/`，构建期）；原生 CSS（无 Tailwind / 组件库）；Windows 路径与中文 UI 必须可用。
- **Locale**: primary `zh-CN`，secondary `en`，整页切换，localStorage `toksight-locale`。
- **Fonts**: Geist Sans / Geist Mono（`geist` 本地打包，运行时不联网）。MASTER 与本文件
  使用同一套字体；禁止 Google Fonts `@import`。Mono 承载全部数据文本（标签、数值、表格、
  图表刻度、logo、会话名），Sans 只用于说明文字与正文。

## 2. Color

ANSI 磷光系：黑底、lime 品牌色、绿=缓存语义、终端图表四色。结构色是灰线，不是表面色差。

### Brand

- `--color-primary`: `#c9f24b`（磷光 lime）— 交互、选中、logo chip、hero tokens 数值、
  柱状图、热力图顶档、名次第 1
- `--color-primary-ink`: `#060609` — lime 底上的文字（硬反转用黑字）
- `--color-primary-subtle`: `rgba(201, 242, 75, 0.12)`

### Neutrals

- `--color-bg`: `#060609` — 页面底（工作表外的留白）
- `--color-panel`: `#0e0e15` — 工作表格子
- `--color-panel-2`: `#15151f` — 格内嵌槽（分段轨道、进度槽、code 底、骨架）
- `--color-line`: `#26262f` — 格内 1px 细分（表行、节奏行、热力空格描边）
- `--color-border-strong`: `#4a4a5e` — 外框、**2px 马赛克分隔**（`.frame` / `.kpis` /
  `.sheet` 的 gap 底色）、表头底线、控件描边。内部 2px 网格必须用此色，用 `--color-line`
  当 gap 底会和 panel 糊在一起，读不成工作表。
- `--color-text`: `#e8e8f2` / `--color-text-secondary`: `#a0a0b6` / `--color-text-muted`: `#82829c`

### Semantic

- `--color-success`: `#3ddc97` — 缓存命中率、缓存读取、模型条缓存段
- `--color-warning`: `#ffb020` / `--color-error`: `#ff5c5c`

### Charts

Token 四类（ANSI 磷光）：`input #c9f24b`（lime）/ `cache-read #3ddc97`（green）/
`cache-write #c86bff`（magenta）/ `output #ffb84d`（amber）。

热力图 5 档（lime 强度 ramp）：`#101018` / `#202d10` / `#374d16` / `#6f9b26` / `#c9f24b`。

分类色 `--color-cat-1..5`：`#c9f24b #9a9ab2 #6a6a84 #4a4a62 #2e2e42`（lime 主导 + 灰阶），
与 `web/lib/palette.js` 一一对应。**按名次取色**：降序第 1 名 lime，其余灰阶——编码排名
而非身份；趋势 Agent 模式、Agent 份额条、模型排行条按同一排序取色。

### Ambient

无。纯黑底 + 硬线；无光晕、无纹理、无模糊（Brutalism 明确不用 backdrop blur）。

### Dark mode

只出深色，无浅色 override。

## 3. Typography

- **Geist Sans / Geist Mono**：`geist` npm 包本地打包，CSS 变量 `--font-geist-sans` /
  `--font-geist-mono`。数据文本（标签、数值、表格、图表、会话名、logo）全 mono；说明
  文字用 sans。
- Type scale (px)：`11(微标签) / 12 / 14 / 16 / 24 / 34(hero)`。hero 数值 34px mono 700。
- 微标签（stat-label、表头、desc）：mono uppercase、`letter-spacing: 0.08em`、11px。
- 数字 `tabular-nums`；正文 `line-height: 1.7`；标题不收紧字距（mono 无需）。

## 4. Spacing / Radius / Elevation / Motion

- Spacing base 4px：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 48`；格子 padding 20/24；网格线 2px。
- **Radius：全部 0**（方角是风格核心，勿加圆角）。
- **Elevation：零阴影、零模糊**。层级=边框粗细（外框与马赛克 2px `--color-border-strong`、
  格内 1px `--color-line`）+ 底色差（panel / panel-2）。
- **Charts**：趋势为按日 **阶梯堆叠**（step-after 实心带，`shape-rendering: crispEdges`），
  禁止贝塞尔 / monotone-cubic 光滑山形与半透明填充（那会读成渐变）。悬停标记为方点。
  热力图方格、**2px** 缝。模型条用两段相邻实色（缓存绿 + 名次色），不用 `linear-gradient`。
  图例色块 8×8 方角，禁止圆点。
- **页面流式宽度**：`.wrap` max-width 1680px + 页边留白 clamp(12px, 2.5vw, 40px)；
  工作表 `.frame` 撑满 wrap；图表 ResizeObserver 自适应。
- **Motion（Brutalism：硬切换 + 必要的展开反馈）**：
  - 悬停/选中/按钮：**无过渡，瞬时硬反转**（lime 底黑字 / 亮线）；active 时 `translateY(1px)`
    模拟按压。
  - 保留的动画（均受 `prefers-reduced-motion` 全局关闭）：Agent 行展开
    （`grid-template-rows 0fr → 1fr`，0.25s）与 caret 旋转；趋势图在用户切换范围/维度/序列
    时重放 450ms 擦揭示（首屏静态）；刷新图标旋转；骨架屏脉冲；整页首次载入 240ms 淡入。
  - 勿回归：入场错峰、数字滚动、逐格/逐柱生长、呼吸点、一切 hover 渐变过渡。

## 5. Icon system

- **Set**: `lucide-react`（构建期依赖）。`strokeWidth={2}`，尺寸 14–18px。
- 用途限定：**只用于操作与状态**——刷新按钮（RefreshCw）、警告/筛选条、空/错误态、
  Agent 行展开箭头（ChevronDown）。标签、标题、数值不带图标。

## 6. Layout / information hierarchy

1. **页面壳**：body 纯黑留白 → `.wrap` → `.frame`（2px 外框、mono 马赛克，纵向堆叠，
   子元素间 2px `--color-border-strong` 分隔）。
2. **Masthead**（frame 首行，sticky、实底无模糊）：左 = lime 底黑字 mono logo chip
   `toksight` + "上次抓取 …"（取 `generatedAt`，不宣称实时）；右 = 语言分段（方角，
   选中 lime 反转）、自动刷新 checkbox、刷新按钮（方角，hover lime 反转，进行中图标旋转）。
3. 警告条 / 筛选提示条（语义色左边 4px 实条 + 边框，方角）。
4. **KPI 条** `.kpis`（4 格，2px 分隔；≤900px 2×2）：累计 Tokens（lime 值，副行 请求·会话）、
   总费用（副行定价状态）、缓存命中率（**green 值**，副行缓存读 tokens）、活跃天数（副行
   起始日期）。值 34px mono 700。
5. **工作表** `.sheet`（12 列 gap-grid，2px `--color-border-strong` 分隔，格子 `.cell span-N`）：
   - 趋势 `span-12`：范围分段（7/30/90）× 维度分段（构成/Agent）+ 可点击图例（至少留一）
     + 右上合计；头部右侧今日/近7天/近30天/本月方角汇总标签；图表高 300。图形是按日
     **阶梯堆叠实心带**（不是光滑面积山）。
   - 活动热力图 `span-12`：GitHub 风格 53 周、**方格、2px 缝**、lime ramp、少/多图例。
   - Agent 分布 `span-5`（≤1200px `span-6`）｜模型用量 `span-7`：份额条（lime/灰阶名次色）
     + 绿色命中率细条；模型条内绿色缓存读段 + 名次色其余段（两截相邻实色，禁止渐变）+
     "缓存 N%" 方角徽标 + Agent×模型折叠表。
   - 按小时 `span-4`｜按月 `span-4`｜**活跃节奏 `span-4`**（v6 新增：连续活跃、峰值日、
     最长会话三行，label 左 / 值右）。小时轴标签绝对定位在柱心 `(h+0.5)/24`。
   - **会话用量 `span-12`**（v6 恢复）：`topSessions` 按 tokens 排序前 10 的 mono 表——
     序号、Agent、会话（title 缺省用 directory，截断 + title 提示）、tokens、请求、命中率、
     费用、开始时间、活跃时长（activeMs，5 分钟封口）。
6. **页脚**（frame 末行）：时区、统计范围、生成时间、未定价模型、版本与 local-first 声明，
   mono 11px。
7. 命中率统计按每次请求归因（session 切模型会被拆分归入各模型，不误计）。最长会话按
   `activeMs` 排名，壁钟跨度只作副注。

## 7. States

- **Loading**：骨架（`.skel` 脉冲）对齐 KPI 条 + 前两格形状。
- **Empty**：单格 + Inbox 图标 + `toksight env` / `--client` / `--since` 提示。
- **Error**：单格 + TriangleAlert + 失败原因与下一步 + 重试按钮。

## 8. Anti-patterns

- 不要圆角、阴影、模糊、渐变、光晕——方角硬线是风格本体（功能性双色硬分段除外）。
- 不要浅色主题。
- 不要平滑 hover 过渡（brutalism 是瞬时反转）；不要入场动画编排、数字滚动。
- 不要"实时"徽标或呼吸点——导航栏用"上次抓取"时间表述。
- 分类色不要回到彩虹色板；lime + 灰阶是名次编码。
- 不要在动效里忽略 `prefers-reduced-motion`。
- 不要给标签/标题/数值加装饰图标；图标只用于操作与状态。
- 不要把 Inter 等其他字体当升级（本项目用 Geist，mono 主导）。
- 不要把未定价模型藏掉——页脚必须可见。
- 不要用 UTC 日期；日界与筛选跟本机本地时区。
- 同一 Agent/模型在不同图里换颜色。
- 中文界面夹未翻译的 chrome。

## 9. Open questions

- 明暗双主题：暂不需要；颜色全部是 CSS 变量，未来加 `:root[data-theme=light]` 即可。
