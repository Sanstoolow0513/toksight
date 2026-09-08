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

仪表盘为 Brutalism 磷光工作表（v6）：近黑底、方角、硬网格线，数据排版用 Geist Mono；
视觉施工图唯一以 `design-spec.md` 为准。粘性页眉（lime logo chip + 上次抓取时间）之后
是筛选栏、4 格 KPI 条、费用说明与周期比较，再是 12 列工作表：趋势（先方向后细节）、
活动热力图、Agent/模型、按小时/按月/活跃节奏、会话用量表。悬停为瞬时反转，动效全部
遵守 `prefers-reduced-motion`。包含：

- **网页筛选** — 全部数据 / 今天 / 近 7 天 / 近 30 天 / 本月 / 自定义日期，以及 Agent
  选择；应用后汇总、图表、模型和会话同步更新，筛选保存在页面 URL 中，刷新后保留。
- **KPI 条** — 累计 tokens（lime，附请求 · 会话）、参考费用、缓存命中率、活跃天数。
- **趋势格** — 7 / 30 / 90 天窗口 × 两种堆叠（按 token 构成或按 Agent）的按日阶梯实心带；
  图例可点选隐藏序列；格头右侧放今日 / 近 7 天 / 近 30 天 / 本月汇总标签。
- **所选时段** — 指定日期后，趋势与热力图按所选时段重绘；超过 366 天时图表显示最后
  366 天并注明，汇总和比较仍覆盖完整选择；服务端日期按本机时区计算，非法日期（如 2 月
  30 日）会被拒绝。
- **参考费用说明** — 区分工具上报金额、用户价格覆盖、LiteLLM 与内置价格估算，展示有费用
  数据的请求比例、未定价请求和实际用到缓存价格回退的请求数。参考费用不等于订阅账单，
  未定价也不代表免费。
- **周期比较** — 所选时段与紧邻的等长本地日历周期比较（未指定开始日期时默认截止日之前
  最近 7 天）；展示费用、tokens、命中率和请求数变化，以及 Agent / Agent × 模型贡献（按
  费用变化绝对值排序，最多 8 项）；两期共用同一次采集的价格快照，工具上报金额保留原值；
  未结束、缺失、无时间戳与缺失定价均有说明，上期为 0 时不计算增长率。不衡量工作效率或模型质量。
- **活动热力图** — GitHub 风格近 53 周每日 tokens 网格（lime 强度 ramp），悬停看单日明细。
- **Agent 分布** — 各 Agent 的 tokens/费用份额与命中率，点击行展开分模型命中率。
- **模型用量** — 跨 Agent 汇总的模型排行；每根条把缓存读取（绿色）与新流量硬分两段；
  Agent × 模型明细表折叠保留。
- **按小时 / 按月 / 节奏** — tokens 在时段与月份上的分布、连续活跃、峰值日、按*活跃
  时长*计的最长会话。
- **会话用量表** — 按 tokens 排名前 10（标题、tokens、请求、命中率、费用、开始时间、活跃时长）。

启动参数（`--client`、`--since`、`--until`、`--today/--week/--month`）限定服务的可见
范围，网页筛选只能在其内进一步缩小，清除网页筛选不会解除启动限制；若上期落在启动范围
之外，页面会说明无法完整比较。另支持手动刷新、30 秒自动刷新开关与顶栏 中文 / EN 切换
（`localStorage` 键 `toksight-locale`，默认中文）。

API 也接受 `GET /api/data?client=claude&period=7d`。`period` 可为 `all`（默认）/ `today` /
`7d` / `30d` / `month` / `custom`（须同时给出 `since` 与 `until`）；`since` / `until` 可单独
使用；预设周期不能与显式日期混用；未知、重复或无效参数返回 HTTP 400。

### Agent 配置一览（只读 + 迁移）

从仪表盘顶栏进入**配置**（或直接打开 `/config`），查看本机五个 Agent 的用户级配置摘要：
默认模型、认证方式、服务商与端点、模型列表（含上下文长度）、权限/沙箱等关键设置，以及
每项设置来自哪个文件。展开任意 Agent 可查看其配置文件的脱敏原文。页面底部的
**导出、导入与恢复**面板是唯一的写入口（详见下节）。

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
项目级配置、托管/企业策略文件不在扫描范围内。

#### 配置导出、导入与恢复

三种操作，同一个面板：

- **导出**：勾选要迁移的配置文件（凭据文件不在列表里，也永远不可导出），下载单个
  JSON bundle（`toksight-agent-configs.json`）或直接复制 JSON 文本粘贴到别处。bundle
  里的配置是**未脱敏的原文**（迁移需要真实值，包括你自填的服务商密钥），请妥善保管。
- **导入**：选择文件后自动解析并预览，或粘贴 bundle 后点击**查看 / 刷新差异**。
  预览列出本机写入位置、新建 / 修改 / 无变化 / 无法导入状态，并展示脱敏后的逐行差异
  （每侧最多 64 KB / 600 行）。无变化的文件不会写入或生成备份；只有敏感值或格式变化时，
  页面会说明为何原文不同而预览相同。确认后，已存在的文件先备份到 `<config>/toksight/backups/<agent>/`
  再原子替换（临时文件 + rename，不会出现写一半的截断文件）。备份名包含时间与随机后缀，
  复制时拒绝覆盖已有备份，连续导入也能保留各次备份。
- **预览有效性**：页面提交预览时的目标与来源内容指纹；任一内容变化会拒绝该文件，要求重新预览。
  无法读取或超过 1 MB 的本机目标文件也会被拒绝。原文中的绝对路径、环境变量引用、外部命令
  与可检测的语法问题会提示人工检查；不会自动重写路径、安装程序或保证迁移后可用。
- **恢复备份**：在“恢复备份”查看最近 200 份可识别备份 → 预览恢复 → 确认恢复。
  恢复前也会备份当前文件，因此可以再恢复到恢复前的版本。列表只显示元数据，预览仍然脱敏。
  旧备份仅在能唯一确定目标时支持恢复；例如旧 ZCode 两种 `config.json` 备份无法区分时会被省略并提示。
- **范围限制**：导入只接受属于固定白名单的**配置**文件——未知条目与凭据条目一律跳过，
  写入路径按**本机**白名单解析（bundle 里记录的来源路径仅供参考），因此 bundle 无法向
  白名单之外的任何位置写入；skills、规则文件与插件资源不包含在内。目标为符号链接时拒绝
  （替换的是链接本身而非其指向的文件），备份目录/备份文件为符号链接时同样拒绝自动恢复。
  写入失败不残留临时文件，只报告真正落盘的备份。
- **安全**：所有配置端点仅限回环客户端 + localhost `Host` 头，并校验浏览器
  `Sec-Fetch-Site`——即使 `--host` 开放了统计仪表盘；导入 POST 还要求
  `application/json` + 专用请求头（跨站网页无法伪造），请求体上限 10 MB。

### 仪表盘构建产物

npm 包已包含 `web/out/` 中预构建好的静态文件——安装后直接 `toksight web` 即可，无需构建，
也不运行 Next。从源码预览发布版页面（需 Node >=20.9；安装包的 CLI 仍支持 >=20）：

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

toksight 是本地优先的：统计与配置页只**读取**你机器上的本地文件，绝不上传数据。唯一的外部
网络请求是匿名的 LiteLLM 价格拉取；`--offline` 可以连它也关掉。对 Agent 配置的唯一写入
入口是配置页显式发起的导入（先备份、只写白名单文件）；凭据文件永不导出。

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

网页 API 另增 `view`（本机日期、可选 Agent 与启动范围）、`selection`（所选时段的趋势/热力图，
没有日期筛选时为 null）、`costCoverage`（金额来源、未定价与缓存价格回退请求数）和 `comparison`
（本期/上期、变化量及贡献项；无法比较时含原因）。原有 CLI `--json` 字段保持不变。

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
`web/out/` 时需要。三条流程：会话文件 → 解析器 → `collectAll` → CLI 输出或 `/api/data`；
配置文件 → 固定白名单 → 摘要与迁移服务 → `/api/config`；`web/` 源码 → Next 构建 →
`web/out/` → CLI 内置 HTTP 服务器。逐模块说明见 [AGENTS.md](./AGENTS.md)。

```bash
npm run check:package  # 打包并在临时目录离线安装，再验证页面、资源、API 与导入/恢复往返
```

仅安装锁定的网页依赖时需要网络；全程使用临时 Agent fixture，绝不导入真实配置，结束后
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
- [x] Agent 配置只读一览：摘要 + 脱敏原文（`toksight web` → 配置）
- [x] 配置打包 / 导入：bundle 导出 + 预览 + 备份替换（`toksight web` → 配置）
- [ ] TUI watch 模式
- [ ] 更多客户端（Cursor、Windsurf、pi……）
- [ ] `--export csv`、排行榜式分享

## 许可

MIT。与智谱 AI、Anthropic、OpenAI 及各智能体厂商均无关联。
