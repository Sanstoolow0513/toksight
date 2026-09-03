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
| OpenCode | `~/.local/share/opencode/opencode.db`，数据库不可读时回退 `~/.local/share/opencode/storage/message/**/*.json` | `OPENCODE_PATH` |
| Kimi Code | `~/.kimi-code/sessions/**/agents/*/wire.jsonl` | `KIMI_CODE_HOME` |

## 安装

```bash
npm install -g toksight
# 或一次性运行
npx toksight
```

需要 Node.js >= 20。Node >= 22.5 时用内置 `node:sqlite` 直接读取 ZCode 与 OpenCode 的
SQLite 数据库，旧版本会自动回退到各自的日志/JSON 存储。

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
[Next.js](https://nextjs.org) 仪表盘和实时 JSON API，然后自动打开浏览器
（默认 `http://127.0.0.1:4729`）。只绑定本机回环地址，每次请求都重新聚合会话文件——
数据不出你的机器。

仪表盘为 Brutalism 磷光工作表（v6）：近黑底上的 2px 外框马赛克，格子以
`--color-border-strong` 硬网格线分割，方角，数据排版用 Geist Mono。施工图是
`design-spec.md`；`design-system/toksight/MASTER.md` 是它的投影（不是 skill 原始落盘）。
粘性页眉（lime logo chip + 上次抓取时间）之后是 4 格 KPI
条，再是 12 列工作表——趋势领衔（方向先于明细），接着活动热力图、Agent/模型双栏、
按小时/按月/活跃节奏、会话用量表。悬停为瞬时反转；仅保留的动效（行展开、你切换范围/
维度时的图表重放）在 `prefers-reduced-motion` 下全部关闭。包含：

- **KPI 条** — 累计 tokens（lime，附请求 · 会话）、总费用、缓存命中率（绿色）、活跃天数，
  34px mono 大数字
- **趋势格** — 7 / 30 / 90 天窗口 × 两种堆叠维度：按 token 构成（新输入 / 缓存读取 /
  缓存写入 / 输出）或按 Agent；图形是按日阶梯堆叠实心带（不是光滑面积山）；图例可点选
  隐藏序列；今日 / 近 7 天 / 近 30 天 / 本月方角汇总标签放在格头右侧
- **活动格** — GitHub 风格近 53 周每日热力网格（lime 强度 ramp），悬停可看单日明细
- **Agent 分布格** — 各 Agent 份额条（tokens、费用、占比）与缓存命中率，点击行展开
  该 Agent 的分模型命中率
- **模型用量格** — 跨 Agent 汇总的模型排行；每根条内以绿色分段呈现缓存读取占比；
  Agent × 模型明细表折叠保留
- **按小时、按月、活跃节奏** — tokens 流向了哪个时段、哪个月；连续活跃、峰值日、
  按*活跃时长*计的最长会话
- **会话用量表** — 按 tokens 排名前 10（标题、tokens、请求、命中率、费用、开始时间、
  活跃时长）

所有筛选参数（`--client`、`--since`、`--until`、`--today/--week/--month`）对 `web` 同样
生效；页面支持手动刷新、30 秒自动刷新，以及顶栏 中文 / EN 切换（记在 `localStorage` 键
`toksight-locale`，默认中文）。

### Agent 配置一览（只读）

从仪表盘顶栏进入**配置**（或直接打开 `/config`），查看本机五个 Agent 的用户级配置摘要：
默认模型、认证方式、服务商与端点、模型列表（含上下文长度）、权限/沙箱等关键设置，以及
每项设置来自哪个文件。展开任意 Agent 可查看其配置文件的脱敏原文。**该页面只读，不会
修改任何文件。**

读取范围（固定白名单，全部为用户级文件）：

| Agent | 读取的文件 |
|---|---|
| ZCode | `%ZCODE_HOME%\v2\config.json`、`v2\setting.json`、`cli\config.json`、`v2\credentials.json`（仅探测；默认根 `%USERPROFILE%\.zcode`） |
| Claude Code | `%CLAUDE_CONFIG_DIR%\settings.json`、`.claude.json`（状态/MCP，默认在用户主目录）、`.credentials.json`（仅探测；默认 `%USERPROFILE%\.claude`） |
| Codex CLI | `%CODEX_HOME%\config.toml`、`auth.json`（仅提取登录方式）、`.env`（仅变量名）、`*.config.toml` profiles（默认 `%USERPROFILE%\.codex`） |
| OpenCode | `%OPENCODE_CONFIG_DIR%\opencode.json` / `opencode.jsonc`、数据目录 `auth.json`（仅提取服务商名）、状态目录 `model.json`（默认 `%USERPROFILE%\.config\opencode` 等，支持 `OPENCODE_CONFIG` 覆盖） |
| Kimi Code | `%KIMI_CODE_HOME%\config.toml`、`tui.toml`、`mcp.json`、`region`、`credentials\kimi-code.json`（仅探测；默认 `%USERPROFILE%\.kimi-code`） |

凭据文件**永不显示内容**——只报告是否存在，或提取登录方式（如 Codex 的 `chatgpt` /
`apikey`）与 OAuth 状态。普通配置文件的原文预览会把密钥、令牌类值替换为 `[REDACTED]`：
Claude `settings.json` 的 `env` 块按变量名逐项判断（`ANTHROPIC_BASE_URL`、
`ANTHROPIC_MODEL` 可见，`ANTHROPIC_API_KEY` 隐藏），因此第三方中转配置仍具可读性。
项目级配置、托管/企业策略文件不在扫描范围内。配置 API 仅限本机回环客户端访问，
即使 `--host` 开放了统计仪表盘。


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

参数：`--port <n>`（默认 4729）、`--host <addr>`（默认 127.0.0.1）、`--no-open`
（不自动开浏览器）、`--api-only`（只开 JSON API，供 UI 开发——配合 `web/` 下的
`npm run web:dev` 使用）。无论 `--host` 如何设置，配置页始终只允许回环客户端访问。

### 缓存命中率

`cacheRead / (新鲜输入 + cacheRead)` — 即提示词 token 中由缓存服务的比例。缓存**写入**不计入
分母（那是被存储的冷数据，不是被服务的流量）。统计按**每次请求**归因：一个会话中途切换模型，
会被干净地拆分到分 Agent / 分模型视图里——缓存本来就绑定模型，A 模型的缓存不可能对 B 模型
命中，因此按请求归属是精确的。ZCode 上报的 `input_tokens` 是含缓存读取的完整提示词，toksight
会先扣除缓存部分得到新鲜输入，让该公式在各 Agent 间口径一致。

## 隐私

toksight 是本地优先的：统计与配置页都只**读取**你机器上的本地文件，绝不上传数据，也不会修改
任何 Agent 配置。唯一的外部网络请求是匿名的 LiteLLM 价格拉取；`--offline` 可以连它也关掉。

## JSON 输出

所有命令都支持 `--json`（如 `toksight daily --json`）。结构包含：`totals`、`cacheHitRate`、
`clients`、`models`、`daily`、`monthly`、`sessions`、`pricing`（含 `unpricedModels`）、`warnings`。
`clients` 的每一项是该 Agent 的 totals 外加它自己的 `cacheHitRate`；该映射由**过滤后**的
entries 构建，`--client` / `--since` / `--until` 对它与其余切片一样生效。

`warnings` 会披露采集问题（无法读取的目录、存在但打不开的 SQLite 数据库）和数据口径问题——
尤其是被 `--since` / `--until` 过滤排除的“无时间戳”条目，会在这里报告而不是无声消失。

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
src/cli.js             子命令分发 + 采集管线（collectAll）
src/args.js            命令行参数解析（--flag value / --flag=value）
src/render.js          文本渲染（表格、摘要、警告）
src/payload.js         --json / web API 的载荷契约
src/dates.js           共享的本地时间日期工具（DST 安全）
src/agentconfigs.js    固定白名单配置读取与结构化摘要（含 src/toml.js TOML 解析）
src/pricing.js         内置价格表 + LiteLLM 缓存 + 用户覆盖
src/aggregate.js       分组与合计
src/webdata.js         网页仪表盘聚合（热力图、趋势、会话……）
src/webserver.js       `toksight web` 的零依赖 HTTP 服务器
src/format.js          ANSI 表格与数字格式化
src/fsutils.js         walkFiles、readJsonl、readJson、pathExists
src/clients/           每个 agent 一个解析器，归一化为统一数据结构
                       （共享 src/clients/sqlite.js 只读打开助手）
web/                   Next.js 仪表盘 + /config 页面（静态导出，由 CLI 托管）
```

CLI 本体保持**零运行时依赖**；仪表盘的依赖只存在于 `web/package.json`，
仅在（重新）构建 `web/out/` 时需要。

### 路线图

- [x] 网页仪表盘（`toksight web`，第二阶段）
- [x] Agent 配置只读一览：摘要 + 脱敏原文（`toksight web` → 配置）
- [ ] TUI watch 模式
- [ ] 更多客户端（Cursor、Windsurf、pi……）
- [ ] `--export csv`、排行榜式分享

## 许可

MIT。与智谱 AI、Anthropic、OpenAI 及各智能体厂商均无关联。
