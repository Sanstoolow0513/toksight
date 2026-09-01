# 🔭 toksight

**在终端里追踪 AI 编程智能体的 token 用量、成本和缓存命中率。**

toksight 读取各 AI 编程智能体已经写在本地磁盘的会话文件，输出总量、按模型 / 按天 / 按会话的
统计以及成本估算。纯 Node.js CLI，零运行时依赖，并自带本地网页仪表盘（`toksight web`）用于
可视化分析。

设计思路参考了 [tokscale](https://github.com/junhoyeo/tokscale)（以及同类工具
[ccusage](https://github.com/ryoppippi/ccusage)），实现为全新编写。English docs:
[README.md](./README.md)。

## 支持的客户端

| 客户端 | 数据来源（默认） | 环境变量覆盖 |
| --- | --- | --- |
| ZCode | `~/.zcode/cli/db/db.sqlite`，数据库不可读时回退 `~/.zcode/cli/rollout/*.jsonl` | `ZCODE_HOME` |
| Claude Code | `~/.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR` |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | `CODEX_HOME` |
| OpenCode | `~/.local/share/opencode/storage/message/**/*.json` | `OPENCODE_PATH` |
| Kimi Code | `~/.kimi-code/sessions/**/agents/*/wire.jsonl` | `KIMI_CODE_HOME` |

## 安装

```bash
npm install -g toksight
# 或一次性运行
npx toksight
```

需要 Node.js >= 20。Node >= 22.5 时用内置 `node:sqlite` 直接读取 ZCode 的 SQLite 数据库，
旧版本会自动回退到 rollout 日志。

## 使用

```bash
toksight              # 总览：合计 + 按客户端 + Top 模型（默认命令）
toksight daily        # 按天统计
toksight monthly      # 按月统计
toksight models       # 按模型统计
toksight sessions     # 按成本排序的会话
toksight web          # 本地网页仪表盘（热力图、趋势与模型分析）
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
--no-open        不自动打开浏览器（仅 web）
--api-only       web：只提供 JSON API，不托管静态页面
--offline        跳过 LiteLLM 价格拉取
--no-color       关闭 ANSI 颜色
```

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

## 网页仪表盘

`toksight web` 启动一个小型本地服务器（零依赖 `node:http`），托管静态导出的
[Next.js](https://nextjs.org) 仪表盘和实时 JSON API，然后自动打开浏览器
（默认 `http://127.0.0.1:4729`）。只绑定本机回环地址，每次请求都重新聚合会话文件——
数据不出你的机器。

仪表盘为流式卡片布局，带入场 / 数字滚动 / 图表揭示动画（`prefers-reduced-motion` 下自动
关闭）。包含：

- **活动卡片** — 紧凑统计条（累计 tokens 与费用、缓存命中率、活跃天数、连续活跃、峰值日、
  按*活跃时长*计的最长会话）+ GitHub 风格近 53 周每日热力网格，悬停可看单日明细
- **趋势卡片** — 7 / 30 / 90 天窗口 × 两种堆叠维度交叉统计：按 token 构成（新输入 / 缓存
  读取 / 缓存写入 / 输出）或按 Agent；图例可点选隐藏序列；今日 / 近 7 天 / 近 30 天 / 本月
  汇总胶囊取代了旧的时间范围表
- **Agent 分布卡片** — 各 Agent 份额条（tokens、费用、占比）与缓存命中率，点击行展开
  该 Agent 的分模型命中率
- **模型用量卡片** — 跨 Agent 汇总的模型排行；每根条内以绿色分段呈现缓存读取占比，
  缓存为主的模型不再"看着很多"；Agent × 模型明细表折叠保留
- **按小时与按月直方图** — tokens 和费用流向了哪个时段、哪个月

会话排行榜已从界面移除（API 仍保留 `topSessions` 字段）。所有筛选参数（`--client`、
`--since`、`--until`、`--today/--week/--month`）对 `web` 同样生效；页面支持手动刷新、
30 秒自动刷新，以及顶栏 中文 / EN 切换（记在 `localStorage` 键 `toksight-locale`，默认中文）。

### 仪表盘构建产物

npm 包已包含 `web/out/` 中预构建好的静态文件，安装后的用户可以直接启动：

```bash
toksight web
```

从源码开发时，先安装仪表盘的构建期依赖，再构建一次：

```bash
npm run web:install
npm run web:build
```

执行 `npm pack` 或 `npm publish` 时会自动重新构建仪表盘。从源码运行且 `web/out/` 尚未构建
时，`toksight web` 会在 `/` 显示构建指引页，`/api/data` 仍可正常使用。

参数：`--port <n>`（默认 4729）、`--host <addr>`（默认 127.0.0.1，仅回环）、`--no-open`
（不自动开浏览器）、`--api-only`（只开 JSON API，供 UI 开发——配合 `web/` 下的
`npm run web:dev` 使用）。

### 缓存命中率

`cacheRead / (新鲜输入 + cacheRead)` — 即提示词 token 中由缓存服务的比例。缓存**写入**不计入
分母（那是被存储的冷数据，不是被服务的流量）。统计按**每次请求**归因：一个会话中途切换模型，
会被干净地拆分到分 Agent / 分模型视图里——缓存本来就绑定模型，A 模型的缓存不可能对 B 模型
命中，因此按请求归属是精确的。ZCode 上报的 `input_tokens` 是含缓存读取的完整提示词，toksight
会先扣除缓存部分得到新鲜输入，让该公式在各 Agent 间口径一致。

## 隐私

toksight 是本地优先的：只**读取**你机器上的会话文件，绝不上传数据。唯一的网络请求是匿名的
LiteLLM 价格拉取；`--offline` 可以连它也关掉。

## JSON 输出

所有命令都支持 `--json`（如 `toksight daily --json`）。结构包含：`totals`、`cacheHitRate`、
`clients`、`models`、`daily`、`monthly`、`sessions`、`pricing`（含 `unpricedModels`）、`warnings`。
`clients` 的每一项是该 Agent 的 totals 外加它自己的 `cacheHitRate`；该映射由**过滤后**的
entries 构建，`--client` / `--since` / `--until` 对它与其余切片一样生效。

网页仪表盘消费同一份载荷（外加 web 专属字段：`heatmap`、`trend`、`trend7`、`trend90`、
`trendByAgent`、`hourly`、`today`、`last7Days`、`last30Days`、`thisMonth`、`activeDays`、
`streaks`、`peakDay`、`topSessions`、`longestSession`、`activityRange`、`timezone`），
来自其同源的 `GET /api/data`。会话行同时携带 `durationMs`（原始壁钟跨度）与 `activeMs`
（请求间隔按 5 分钟封口后的活跃时长）；`longestSession` 按 `activeMs` 排名，挂机过夜的
会话不会再把空闲时间算成时长。

## 开发

```bash
npm test              # node:test 套件 + 各客户端 fixture（无需联网）
node bin/toksight.js  # 从源码直接运行
npm run web:install   # 安装仪表盘构建期依赖
npm run web:dev       # 开发仪表盘 UI（需先跑着 `toksight web --api-only`）
```

```
bin/toksight.js        可执行入口
src/cli.js             参数解析、子命令、渲染
src/clients/           每个 agent 一个解析器，归一化为统一数据结构
src/pricing.js         内置价格表 + LiteLLM 缓存 + 用户覆盖
src/aggregate.js       分组与合计
src/webdata.js         网页仪表盘聚合（热力图、趋势、会话……）
src/webserver.js       `toksight web` 的零依赖 HTTP 服务器
src/format.js          ANSI 表格与数字格式化
web/                   Next.js 仪表盘（静态导出，由 CLI 托管）
```

CLI 本体保持**零运行时依赖**；仪表盘的依赖只存在于 `web/package.json`，
仅在（重新）构建 `web/out/` 时需要。

### 路线图

- [x] 网页仪表盘（`toksight web`，第二阶段）
- [ ] TUI watch 模式
- [ ] 更多客户端（Cursor、Windsurf、pi……）
- [ ] `--export csv`、排行榜式分享

## 许可

MIT。与智谱 AI、Anthropic、OpenAI 及各智能体厂商均无关联。
