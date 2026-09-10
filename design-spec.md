# toksight Design Specification

> v7（2026-09）：推倒重来——视觉语言从「Brutalism 磷光终端工作表」切换为 **极简文档风
> （Editorial Paper）**：暖纸底、白卡片、1px 发丝线、大留白、印刷排版节奏。v6 的 2px 硬框、
> 马赛克网格、硬反转交互、磷光色板全部废止。保留的纪律：名次取色（第 1 名用墨色，其余中性
> 灰阶）、cache 绿是语义色、图标只服务操作与状态、不藏未定价模型、本地时区、
> `prefers-reduced-motion` 全局关闭动效。施工图以本文件为准，禁止用任何泛 SaaS 模板
> （阴影堆砌、渐变光晕、Google Fonts、彩虹色板）覆盖。布局、信息层级、动效、图标系统以
> 本文件为准。

## 1. Design direction

- **Product**: 本地优先的 AI coding agent token 用量仪表盘（`toksight web`）及只读的配置一览页。
  统计与配置页都只读取本地文件，唯一的写路径是配置导入（备份先行）。数据不出机器。
- **Style family**: 极简文档风——页面是一份排印良好的工作文档：暖纸底上依次排布白色卡片，
  卡片靠 1px 发丝线（hairline）描边与底色差区分，不用阴影；区块内部用发丝线分节；留白克制
  而均匀。Sans 承载阅读，Mono 承载数据。
- **Tone**: 安静、清晰、编辑感；这是给人每天看的工作文档，不是给客户演示的 SaaS 皮肤，
  也不是终端模拟器。
- **Hard constraints**: 只出浅色（无深色主题）；中英可切；根 CLI 零运行时依赖（dashboard 依赖
  只允许在 `web/`，构建期）；原生 CSS（无 Tailwind / 组件库）；Windows 路径与中文 UI 必须可用。
- **Locale**: primary `zh-CN`，secondary `en`，整页切换，localStorage `toksight-locale`。
- **Fonts**: Geist Sans / Geist Mono（`geist` 本地打包，运行时不联网）。禁止 Google Fonts
  `@import`，禁止引入第三款字体。Sans 是默认字体；Mono 只给数据（见 §3）。

## 2. Color

纸面中性色 + 单一赭橙强调色 + 语义绿。强调色克制：只给交互、选中、链接与主 KPI。

### Accent

- `--color-accent`: `#c2410c`（赭橙，编辑红感）— 链接、选中态、focus 环、交互悬停、
  累计 Tokens 的 KPI 值
- `--color-accent-ink`: `#ffffff` — accent 底上的文字
- `--color-accent-subtle`: `rgba(194, 65, 12, 0.08)` — 选中行/分段选中底

### Neutrals

- `--color-bg`: `#f7f6f3` — 页面纸底（暖白）
- `--color-panel`: `#ffffff` — 卡片
- `--color-panel-2`: `#f0eee9` — 卡内嵌槽（分段控件轨道、进度槽、code 底、骨架屏）
- `--color-line`: `#e7e4de` — 发丝线：卡片描边、表行分隔、图内网格
- `--color-line-strong`: `#d6d3cc` — 表头底线、控件描边、输入框边
- `--color-text`: `#1a1917`（墨色）/ `--color-text-secondary`: `#57534e` /
  `--color-text-muted`: `#8a857c`

### Semantic

- `--color-success`: `#15803d` — 缓存命中率、缓存读取、模型条缓存段
- `--color-warning`: `#b45309` / `--color-error`: `#b91c1c`
- 语义色不配大面积底色块；banner 用白底 + 左侧 3px 语义色条 + 同色图标与标题。

### Charts

Token 四类（纸面可读，cache 保持绿色语义）：
`input #1a1917`（墨）/ `cache-read #15803d`（绿）/ `cache-write #a8a39a`（中灰）/
`output #d6d3cc`（浅灰）。

热力图 5 档（paper→ink 单色 ramp）：`#f0eee9` / `#d6d3cc` / `#a8a39a` / `#57534e` / `#1a1917`。

分类色 `--color-cat-1..5`：`#1a1917 #6f6a63 #a8a39a #d6d3cc #eae8e2`（墨色主导 + 暖灰阶），
与 `web/lib/palette.js` 一一对应（`test/palette.test.js` 守住双份事实源）。**按名次取色**：
降序第 1 名墨色，其余灰阶递减——编码排名而非身份；趋势 Agent 模式、Agent 份额条、模型
排行条按同一排序取色。

### Ambient

无。纸底 + 发丝线；无纹理、无光晕、无模糊、无阴影。

### Dark mode

只出浅色，无深色 override。

## 3. Typography

- **Geist Sans 是默认字体**：标题、正文、说明、按钮、导航。**Geist Mono 只承载数据**：
  数值、表格、图表刻度、会话名、路径、logo、微标签。
- Type scale (px)：`11(微标签) / 12 / 14 / 16 / 20 / 28 / 40(hero)`。KPI 大数字 40px mono 600。
- 微标签（stat-label、表头、desc）：mono uppercase、`letter-spacing: 0.08em`、11px、
  `--color-text-muted`。
- 数字 `tabular-nums`；正文 `line-height: 1.7`；标题用 Sans 600，字距正常。

## 4. Spacing / Radius / Elevation / Motion

- Spacing base 4px：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 48`；卡片 padding 24；卡片间距 16，
  大区块间距 24。
- **Radius**：`--radius: 6px`（卡片、控件、按钮、chip 统一用它）；热力图格 3px；4–6px 高
  的份额条/命中率细条用 2–3px（用 6px 会读成 pill）；表格与发丝线保持直角。禁止 pill 形
  大圆角按钮。
- **Elevation**：零阴影、零模糊。层级 = 白卡片 + 1px `--color-line` 描边 + 底色差
  （panel / panel-2）。sticky masthead 用白底 + 底部发丝线，不加阴影。
- **Charts**：趋势为按日**阶梯堆叠**（step-after，贴合数据的离散本质），色带用 v7 图表四色
  实色平铺，相邻色带间 1px 纸色缝，最顶层色带上沿 1.5px 描边；禁止贝塞尔光滑曲线与渐变
  填充。悬停为竖向 1px 参考线 + 各色带值读数。热力图方格 12px、圆角 3px、2px 缝。
  模型条用两段相邻实色（缓存绿 + 名次色），不用 `linear-gradient`。图例色块 10×10、
  圆角 2px。
- **页面流式宽度**：`.wrap` 全宽流体（无 max-width 上限）+ 页边留白 clamp(16px, 4vw, 48px)；图表
  ResizeObserver 自适应。
- **Motion（文档风：安静的 150–250ms 颜色/透明度过渡）**：
  - 悬停/选中：`color` 与 `background-color` 150ms ease 过渡（废止 v6 的瞬时硬反转）；
    主按钮为 accent 底白字，hover 加深；次按钮白底发丝线，hover 底色变 panel-2。
  - 保留的动画（均受 `prefers-reduced-motion` 全局关闭）：Agent 行展开
    （`grid-template-rows 0fr → 1fr`，0.25s）与 caret 旋转；刷新图标旋转；骨架屏脉冲；
    整页首次载入 200ms 淡入。
  - 新增：筛选切换时旧数据保留并 200ms 淡入新数据（不再整页闪骨架屏）。
  - 勿回归：入场错峰、数字滚动、逐格/逐柱生长、呼吸点、一切阴影/模糊"高级感"。

## 5. Icon system

- **Set**: `lucide-react`（构建期依赖）。`strokeWidth={1.5}`，尺寸 14–18px。
- 用途限定：**只用于操作与状态**——刷新按钮（RefreshCw）、成功/警告/筛选/空/错误态，
  以及展开箭头（ChevronDown）。标签、标题、数值不带图标。

## 6. Layout / information hierarchy

1. **页面壳**：body 暖纸底 → `.wrap`（全宽流体，clamp 页边留白）→ 纵向卡片流 `.frame`（无外框、无马赛克
   分隔；卡片即白底发丝线块，间距 16）。
2. **Masthead**（全宽白底 sticky，底部 1px 发丝线，内容随 wrap 居中）：左 = mono logo
   `toksight`（accent 色方块句点 `toksight.`）+ 页面元信息；右 = 仪表盘/配置文字导航
   （当前页 accent 下划线）、语言分段（选中为 accent-subtle 底 + accent 字）与页面操作。
   仪表盘元信息为“上次抓取 …”（取 `generatedAt`，不宣称实时），操作为自动刷新 checkbox +
   刷新按钮（白底发丝线，hover 变 panel-2，进行中图标旋转）。
3. 警告条 / 筛选提示条（白底卡片 + 左侧 3px 语义色条）。
4. **KPI 条** `.kpis`（4 张白卡，间距 16；≤900px 2×2）：累计 Tokens（**accent 值**，副行
   请求·会话）、总费用（副行定价状态）、缓存命中率（**缓存绿值**，副行缓存读 tokens）、
   活跃天数（副行起始日期）。值 40px mono 600。
5. **工作表** `.sheet`（12 列网格，gap 16，格子为白卡 `.cell span-N`）：
   - 趋势 `span-12`：范围分段（7/30/90）× 维度分段（构成/Agent）+ 可点击图例（至少留一）
     + 右上合计；头部右侧今日/近7天/近30天/本月汇总标签；图表高 300。图形是按日阶梯堆叠
     实色带（见 §4）。
   - 活动热力图 `span-12`：GitHub 风格 53 周、方格 3px 圆角、2px 缝、paper→ink ramp、
     少/多图例。
   - Agent 分布 `span-5`（≤1200px `span-6`）｜模型用量 `span-7`：份额条（名次灰阶）
     + 绿色命中率细条；模型条内绿色缓存读段 + 名次色其余段（两截相邻实色，禁止渐变）+
     "缓存 N%" 徽标（panel-2 底）+ Agent×模型折叠表。
   - 按小时 `span-4`｜按月 `span-4`｜活跃节奏 `span-4`（连续活跃、峰值日、最长会话三行，
     label 左 / 值右）。小时轴标签绝对定位在柱心 `(h+0.5)/24`。
   - 会话用量 `span-12`：`topSessions` 按 tokens 排序前 10 的 mono 表——序号、Agent、会话
     （title 缺省用 directory，截断 + title 提示）、tokens、请求、命中率、费用、开始时间、
     活跃时长（activeMs，5 分钟封口）。

   以上为**默认排布**：容器宽 ≥900px 时 KPI 四卡、周期对比、成本明细与全部 sheet 格子都是
   可拖拽/可缩放的网格项（见下节）；<900px 回退为该静态纵向流。

### Dashboard grid 交互（react-grid-layout v2）

- **网格**：12 列、rowHeight 36px、间距 16px、无内边距；卡片即网格项，默认坐标定义在
  `web/lib/layout.js`（`defaultLayout()`，含每卡 minW/minH）。
- **拖拽把手** = 卡片头 `.cell-head`；无卡头的卡片（KPI 四卡、成本明细）整卡可拖；
  链接/按钮/输入框/summary 等交互元素不触发拖拽。**缩放手柄**只在右下角：细线小角标
  （`--color-line-strong`），悬停卡片时显现。
- **占位框**：`--color-panel-2`  recessed 底 + 1px dashed accent 描边；拖拽中的卡片描边变
  accent 发丝线。全程禁止阴影/渐变。
- **持久化**：布局存 localStorage `toksight-layout-v1`（仅 i/x/y/w/h，拖拽/缩放结束时写入）；
  masthead 操作区有“重置布局”按钮（RotateCcw 图标 + 文字），清键并恢复默认。
- **动效**：网格项位移/尺寸过渡 200ms ease-out；`prefers-reduced-motion` 由全局 `*` 规则
  一并关闭。容器宽 <900px（或未完成测量，含静态导出首屏）时渲染静态流，现有媒体查询把
  各 span 折叠为单列，移动端体验不变。
- **填满**：卡片内容区 `flex:1; min-height:0`，超长列表（会话表/Agent/模型）卡内滚动；
  趋势图 ResizeObserver 同时观测高度（下限 240px，静态回退保持 300px）；tooltip 为
  `position:fixed`（Tip.jsx），网格项用 top/left 定位（absoluteStrategy），不作变换，
  因此浮层不被裁剪。
6. **页脚**：muted 11px mono：时区、统计范围、生成时间、未定价模型、版本与 local-first 声明。
7. 命中率统计按每次请求归因（session 切模型会被拆分归入各模型，不误计）。最长会话按
   `activeMs` 排名，壁钟跨度只作副注。

### `/config` 配置一览页（只读 + 导出/导入/恢复）

- 与仪表盘共享 `.wrap → .frame → masthead → footer` 壳和中英切换；同款白卡发丝线语言。
- 顺序：标题/范围说明 → 凭据安全 warning banner → 五个 Agent 的纵向堆叠区（卡片间距 16）。
  所有视口单列。
- 每个 Agent 一张 `config-agent` 卡：头部为 Agent 名 + 文件/服务商/模型计数 + 认证方式
  徽标；正文自上而下为：默认模型/认证/MCP 的 `config-kv` 网格 → `config-facts` 双列事实
  标签（label + 等宽值）→ 服务商表格（名称/类型/端点/认证/状态/模型数，单元格省略号）
  → 模型芯片组（按 provider 分组的 `.chip`，含上下文长度）。无配置时显示空态说明。
- 每张卡片底部“查看 N 个文件”折叠开关展开 `config-file` 列表：文件名/格式/状态标签、
  路径/大小/修改时间，以及内嵌的 64 KB 脱敏 `<pre>` 预览（panel-2 底）。凭据文件永不渲染
  预览，只显示“凭据文件：内容不显示。”缺失文件降透明度。
- 风险条必须明确：凭据永不显示；预览中的敏感值已替换为 [REDACTED]；页面只读（除导入）。
  图标仍只服务展开与语义状态（ChevronDown、ShieldAlert、RefreshCw、TriangleAlert）。
- 数据由 `GET /api/config`（仅回环、仅 GET/HEAD、要求 localhost `Host` 头）提供：每个 agent 带
  `files` 元数据与 `summary`（defaultModel、auth、facts、providers、models、mcpServers）；
  摘要中的值同样过 `redactString`。

## 7. States

- **Loading**：首屏骨架（`.skel` 脉冲，panel-2 底）对齐 KPI 条 + 前两格形状；筛选切换不再
  退回整屏骨架，保留旧数据 + masthead 刷新图标旋转。
- **Empty**：白卡 + Inbox 图标 + `toksight env` / `--client` / `--since` 提示。
- **Error**：白卡 + TriangleAlert + 失败原因与下一步 + 重试按钮。

## 8. Anti-patterns

- 不要深色主题、磷光/霓虹色——纸面浅色系是风格本体。
- 不要阴影、模糊、渐变、光晕、纹理——层级靠发丝线与底色差。
- 不要 v6 的 2px 硬框/马赛克网格/瞬时硬反转——那是上一版语言。
- 不要"实时"徽标或呼吸点——导航栏用"上次抓取"时间表述。
- 分类色不要彩虹色板；墨色 + 灰阶是名次编码，cache 绿是唯一例外（语义）。
- 不要把 accent 橙当装饰大面积铺；它只给交互与选中。
- 不要在动效里忽略 `prefers-reduced-motion`。
- 不要给标签/标题/数值加装饰图标；图标只用于操作与状态。
- 不要把 Inter 等其他字体当升级（本项目用 Geist；Sans 承载阅读，Mono 承载数据）。
- 不要把未定价模型藏掉——页脚必须可见。
- 不要用 UTC 日期；日界与筛选跟本机本地时区。
- 同一 Agent/模型在不同图里换颜色。
- 中文界面夹未翻译的 chrome。
- 不要 pill 形大圆角按钮与卡片（radius 统一 6px，热力图格 3px）。

## 9. Open questions

- 明暗双主题：暂不需要；颜色全部是 CSS 变量，未来加 `:root[data-theme=dark]` 即可
  （需另配一套纸面→深墨的 token 映射，不是简单反色）。
