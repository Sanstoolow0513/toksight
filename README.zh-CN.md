# 🔭 toksight

**在终端里追踪 AI 编程智能体的 token 用量、成本和缓存命中率。**

toksight 读取各 AI 编程智能体已经写在本地磁盘的会话文件，输出总量、按模型 / 按天 / 按会话的
统计以及成本估算。纯 Node.js CLI，零运行时依赖，并自带本地网页报告（`toksight web`）：
热力图、Agent 与模型分布，一键导出图片。

设计思路参考了 [tokscale](https://github.com/junhoyeo/tokscale)（以及同类工具
[ccusage](https://github.com/ryoppippi/ccusage)），实现为全新编写。English docs:
[README.md](./README.md)。

## 支持的客户端

| 客户端 | 数据来源（默认） | 环境变量覆盖 |
| --- | --- | --- |
| ZCode | `~/.zcode/cli/db/db.sqlite`，数据库不可读时回退 `~/.zcode/cli/rollout/*.jsonl` | `ZCODE_HOME` |
| Claude Code | `~/.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR` |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | `CODEX_HOME` |
| OpenCode | `~/.local/share/opencode/opencode.db`，数据库不可读时回退 `~/.local/share/opencode/storage/message/**/*.json` | `OPENCODE_PATH` |
| Kimi Code | `~/.kimi-code/sessions/**/agents/*/wire.jsonl` | `KIMI_CODE_HOME` |

## 安装

```bash
npm install -g toksight
# 或一次性运行
npx toksight
```

需要 Node.js >= 22.5。内置 `node:sqlite` 用于读取 ZCode 与 OpenCode 数据库，并保存
toksight 自己的本地用量数据库；无需安装运行时依赖。

## 使用

```bash
toksight              # 总览：合计 + 按客户端 + Top 模型（默认命令）
toksight daily        # 按天统计
toksight monthly      # 按月统计
toksight models       # 按模型统计
toksight sessions     # 按成本排序的会话
toksight web          # 本地用量与成本报告（热力图、Agent、模型，可导出图片）
toksight refresh      # 重新扫描 Agent 并更新本地 SQLite 数据库
toksight env          # 查看检测到的数据源与定价状态
```

示例输出（`toksight --since 2026-08-30 --until 2026-08-31`）：

```
Tokens 68,590,023  Cost $9.25  1081 requests · 33 sessions
input 3.95M · cache read 63.79M (94.2% hit · write 0) · output 849K
range: 2026-08-30 → 2026-08-31 · clients: all

By client
Client  Req  Sessions  Tokens    Hit   Cost
──────  ───  ────────  ──────  ─────  ─────
zcode   533        18  33.68M  91.9%  $2.37
kimi    486        13  32.91M  96.7%  $4.91
codex    62         2   2.00M  90.8%  $1.96

Top models (up to 20)
Client  Model              Req  Input  Cache R  Cache W  Output    Hit     Cost
──────  ─────────────────  ───  ─────  ───────  ───────  ──────  ─────  ───────
kimi    kimi-code/k3       422   986K   29.01M        0    293K  96.7%    $4.51
codex   gpt-5.6-sol         62   183K    1.79M        0   25.7K  90.8%    $1.96
zcode   glm-5.3-flash      487  2.51M   28.45M        0    442K  91.9%    $1.45
zcode   glm-5.3             41   116K    1.99M        0   43.3K  94.5%   $0.870
```

### 参数

```
--client <a,b>   只统计指定客户端（zcode, claude, codex, opencode, kimi）
--since <date>   本地日期（YYYY-MM-DD），含当天
--until <date>   本地日期（YYYY-MM-DD），含当天
--today --week --month   日期快捷方式
--top <n>        models/sessions 表格行数上限（默认 20）
--json           输出机器可读 JSON
--port <n>       网页仪表盘端口（默认 4729）
--host <addr>    网页仪表盘监听地址（默认 127.0.0.1）
--open           用浏览器打开打印出的地址（仅 web）
--no-open        不打开浏览器（仅 web；默认）
--api-only       web：只提供 JSON API，不托管静态页面
--offline        跳过 LiteLLM 价格拉取
--no-color       关闭 ANSI 颜色
```

带值参数支持两种写法：`--since 2026-08-01` 与 `--since=2026-08-01`。

按天分组和日期过滤都使用**本地时区**。

## 定价

成本按每次请求的 token 数计算，三层价格来源（后者覆盖前者）：

1. **内置价格表** — 常见模型系列的最佳努力估算（美元 / 百万 token），离线始终可用。
2. **LiteLLM** — 从社区[模型价格库](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)拉取，
   本地缓存 1 小时（`<config>/toksight/cache/litellm-pricing.json`），数据最新；`--offline` 可跳过。
3. **用户覆盖** — 编辑 `<config>/toksight/pricing.json`（单位：美元 / 百万 token）：

   ```json
   {
     "my-model": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }
   }
   ```

   模型名支持精确匹配或按提供商后缀匹配（`zhipuai/glm-5.3` 也能匹配 `GLM-5.3`）。

`<config>` 为 `%XDG_CONFIG_HOME% || ~/.config`（可用 `TOKSIGHT_CONFIG_DIR` 覆盖）。
查不到价格的模型照常计数，成本显示为 `—`，并在 JSON 输出的 `pricing.unpricedModels` 中列出。
OpenCode 自带的价格（`cost` 字段）会被直接采用。

当 LiteLLM 条目缺少独立的缓存价格时，缓存 token 会按该模型的输入价计费——这是有意选择的
保守高估（真实缓存读取价通常只有输入价的 10% 左右），保证成本不会被悄悄少算；有完整缓存
价格的模型不受影响。

## 网页仪表盘

`toksight web` 启动一个小型本地服务器（零依赖 `node:http`），托管静态导出的
[Next.js](https://nextjs.org) 仪表盘和 JSON API，并打印地址
（默认 `http://127.0.0.1:4729`）。加上 `--open` 会用浏览器打开该地址。默认只绑定本机回环地址。
首次启动会扫描 Agent 文件并创建 `<config>/toksight/usage.sqlite`（可用 `TOKSIGHT_CONFIG_DIR`
覆盖目录）。以后启动会预读取数据库，普通报告和单日请求使用已提交的快照，不会重新扫描 Agent。
数据始终留在本机。

点击顶栏刷新按钮、调用 `POST /api/refresh`，或运行 `toksight refresh`，会重新扫描所有 Agent，
并在一个事务中更新数据库。刷新失败时保留旧快照；网页服务器也会发现其他 toksight 进程写入的
新快照。刷新后报告与打开的单日卡片一同更新，页脚显示数据库上次刷新时间。
`toksight refresh --offline` 可跳过价格拉取。

仪表盘是一页**按月或按年的 token 用量与成本报告**，采用 Claude 的暖色明暗配色，铺在稀疏的
点阵背景上（视觉规范见 `design-spec.md`）。顶栏切换**月 / 年**并逐期前后翻看（最早到第一条
记录所在的周期，不会翻到未来），切换浅色 / 深色 / 跟随系统与 中文 / EN，刷新，以及把报告
导出为图片。页首展示本期 tokens、参考费用、缓存命中率与请求数，下面是三张章节卡片：

1. **活动热力图** — 月视图是日历、年视图是 53 周网格，每格按 tokens 或费用着色（卡片内
   切换），并给出活跃天数、活跃日均、峰值日、最长连续与单日悬停明细。
2. **Agent 分布** — 各 Agent 占本期 tokens 或费用的份额；tokens 模式下长条按输入 / 缓存读 /
   缓存写 / 输出分段，下方附费用、缓存命中率、请求与会话数。
3. **模型分布** — 跨 Agent 合并同名模型，按同样方式排序；超过八个时尾部合并为一行
   “其他 N 个模型”，卡片高度保持可控。

点击热力图上的任意一天，报告旁会展开一张**单日详情卡片**：当天的 tokens、参考费用、缓存命中率与
请求数，24 小时时段分布，同样的 Agent / 模型排行，以及当天的会话（标题、起止时间、活跃时长、
目录与模型）。宽屏时报告列平滑让到一侧、卡片从列边展开，两者一起保持居中；窄屏时卡片悬浮在
页面上。用 ‹ › 逐日切换，点 ×、按 Esc 或再次点击同一天关闭。详情卡片不会进入导出的图片。

按住卡片右上角的拖动手柄（或聚焦手柄后按 ↑ / ↓）即可调整章节顺序。顺序、周期模式、各卡
指标、配色与语言都记在 `localStorage` 里。**导出图片**会把页首、按当前顺序排列的三张卡片与
页脚合成一张 PNG（`toksight-2026-09.png` / `toksight-2026.png`），去掉按钮等控件，方便直接
分享。参考费用是按公开价格估算的，不等于订阅账单；未定价模型会列在页脚。

启动参数（`--client`、`--since`、`--until`、`--today/--week/--month`）限定服务的可见
范围，网页报告不会越过这个范围。

API 可以这样调用：`GET /api/data?period=custom&since=2026-09-01&until=2026-09-30`（报告本身
就这样请求，单日侧栏也用同样方式请求某一天）或 `?client=claude&period=7d`。`period` 可为 `all`（默认）/ `today` / `7d` /
`30d` / `month` / `custom`（须同时给出 `since` 与 `until`）；`since` / `until` 可单独使用；
预设周期不能与显式日期混用；未知、重复或无效参数返回 HTTP 400。`POST /api/refresh`
会更新数据库，并返回刷新时间、记录数和采集警告；网页 API 新增的 `snapshot` 字段包含刷新时间和记录数。
跨来源刷新请求会被拒绝。

### 仪表盘构建产物

npm 包已包含 `web/out/` 中预构建好的静态文件——安装后直接 `toksight web` 即可，无需构建，
也不运行 Next。从源码预览发布版页面需要 Node >=22.5：

```bash
npm run web:ci && npm run web:build && node bin/toksight.js web
```

`web/out/` 尚未构建时，`toksight web` 会在 `/` 显示构建指引页，`/api/data` 不受影响；
`web:build` 只构建不安装依赖，改完前端需重新构建并刷新。`npm pack` / `npm publish`
会自动重建仪表盘。

### 缓存命中率

`cacheRead / (新鲜输入 + cacheRead)` — 即提示词 token 中由缓存服务的比例。缓存**写入**不计入
分母（那是被存储的冷数据，不是被服务的流量）。统计按**每次请求**归因：一个会话中途切换模型，
会被干净地拆分到分 Agent / 分模型视图里——缓存本来就绑定模型，A 模型的缓存不可能对 B 模型
命中，因此按请求归属是精确的。ZCode 上报的 `input_tokens` 是含缓存读取的完整提示词，toksight
会先扣除缓存部分得到新鲜输入，让该公式在各 Agent 间口径一致。

## 隐私

toksight 本地优先：CLI 与网页报告只**读取**各 Agent 的会话文件。刷新会写入 toksight 自己的
SQLite 数据库，不上传数据，也不写回 Agent 文件。唯一的外部网络请求是匿名的 LiteLLM 价格拉取；
`--offline` 可以连它也关掉。
报告图片在浏览器里生成，只保存到你下载的位置。

## JSON 输出

报告命令支持 `--json`（如 `toksight daily --json`）。结构包含：`totals`、`cacheHitRate`、
`clients`、`models`、`daily`、`monthly`、`sessions`、`pricing`（含 `unpricedModels`）、`warnings`。
`clients` 的每一项是该 Agent 的 totals 外加它自己的 `cacheHitRate`；该映射由**过滤后**的
entries 构建，`--client` / `--since` / `--until` 对它与其余切片一样生效。
`toksight refresh --json` 则返回数据库路径、刷新时间、记录数和采集警告。

`warnings` 会披露采集问题（无法读取的目录、存在但打不开的 SQLite 数据库）和数据口径问题——
尤其是被 `--since` / `--until` 过滤排除的“无时间戳”条目，会在这里报告而不是无声消失。

网页仪表盘消费同一份载荷（外加 web 专属字段：`heatmap`、`trend`、`trend7`、`trend90`、
`trendByAgent`、`hourly`、`today`、`last7Days`、`last30Days`、`thisMonth`、`activeDays`、
`streaks`、`peakDay`、`topSessions`、`longestSession`、`activityRange`、`timezone`），
来自其同源的 `GET /api/data`。会话行同时携带 `durationMs`（原始壁钟跨度）与 `activeMs`
（请求间隔按 5 分钟封口后的活跃时长）；`longestSession` 按 `activeMs` 排名，挂机过夜的
会话不会再把空闲时间算成时长。

网页 API 另增 `snapshot`（数据库刷新时间与记录数）、`view`（本机日期、可选 Agent 与启动范围）、
`scopeRange`（启动范围内第一条与
最后一条记录的时间，与所请求的周期无关，报告用它确定翻页边界）、`selection`（所选时段的
趋势/热力图，没有日期筛选时为 null）、`costCoverage`（金额来源、未定价与缓存价格回退请求数）
和 `comparison`（本期/上期、变化量及贡献项；无法比较时含原因）。原有 CLI `--json` 字段保持不变。

## 开发

```bash
npm test              # node:test 套件 + 各客户端 fixture（无需联网）
node bin/toksight.js  # 从源码直接运行
npm run web:ci        # 按 web/package-lock.json 安装锁定的网页依赖
npm run web:dev       # 同时启动 API（4729）和前端（3000），支持热更新
```

打开 `http://127.0.0.1:3000`，无需提前构建 `web/out/`；Ctrl+C 一起关闭前后端，端口被占用
会报错并关闭本命令启动的服务。`npm run web:dev -- --port 3001 --api-port 4730 --offline`
可覆盖两个端口并关闭价格拉取。需要分开管理时，在仓库根目录用两个终端分别跑
`node bin/toksight.js web --api-only` 与 `npm run web:dev:ui`（代理目标可用
`TOKSIGHT_DEV_API` 覆盖，仅影响开发服务器，生产构建始终输出静态文件）。
`web:install` 保留给需要更新网页依赖的开发者。

CLI 本体保持**零运行时依赖**，仪表盘依赖只存在于 `web/package.json`，仅在（重新）构建
`web/out/` 时需要。数据流程：会话文件 → 解析器 → `collectAll` → CLI 输出或 SQLite 刷新 → `/api/data`；
`web/` 源码 → Next 构建 → `web/out/` → CLI 内置 HTTP 服务器。逐模块说明见
[AGENTS.md](./AGENTS.md)。

```bash
npm run check:package  # 打包并在临时目录离线安装，再用 fixture 验证页面、静态资源与数据 API
```

仅安装锁定的网页依赖时需要网络；全程使用临时 Agent fixture，不碰真实数据，结束后
自动清理。PR 与 main 分支的 CI 会在 Ubuntu/Windows 上运行测试与该检查。

### 发布

发布由 [.github/workflows/release.yml](.github/workflows/release.yml) 自动完成：推送一个与
`package.json` 版本一致的 `v*` 标签，工作流会先跑完整测试矩阵（Ubuntu + Windows，Node
20/22/24）与 Ubuntu/Windows 安装包检查，校验标签与包版本一致，然后用自动生成的变更记录创建 GitHub Release。

```bash
# 先同步更新根目录与 web/package.json 的版本及对应 lockfile，再提交
git tag vX.Y.Z                # X.Y.Z 必须与 package.json 一致
git push origin main vX.Y.Z   # 推送标签，触发发布工作流
```

标签与包版本不一致、测试或安装包检查失败时，都不会创建 Release。发布到 npm 是刻意保留的手动
步骤——需要时自行运行 `npm publish`（`prepublishOnly` / `prepack` 脚本会再跑一次测试，并把
`web/out` 重新构建进发布包）。

### 路线图

- [x] 网页仪表盘（`toksight web`，第二阶段）
- [x] 按月 / 按年报告，卡片可拖动排序并导出图片（`toksight web`）
- [ ] TUI watch 模式
- [ ] 更多客户端（Cursor、Windsurf、pi……）
- [ ] `--export csv`、排行榜式分享

## 许可

MIT。与智谱 AI、Anthropic、OpenAI 及各智能体厂商均无关联。
