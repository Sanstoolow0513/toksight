# 🔭 toksight

**在终端里追踪 AI 编程智能体的 token 用量、成本和缓存命中率。**

toksight 读取各 AI 编程智能体已经写在本地磁盘的会话文件，输出总量、按模型 / 按天 / 按会话的
统计以及成本估算。纯 Node.js CLI，零运行时依赖，并自带本地网页报告（`toksight web`）：
热力图、Agent 与模型分布，一键导出图片。

设计思路参考了 [tokscale](https://github.com/junhoyeo/tokscale)（以及同类工具
[ccusage](https://github.com/ccusage/ccusage)），实现为全新编写。English docs:
[README.md](./README.md)。

## 支持的客户端

| 客户端 | 数据来源（默认） | 环境变量覆盖 |
| --- | --- | --- |
| ZCode | `~/.zcode/cli/db/db.sqlite`，数据库不存在或不可读时回退 `~/.zcode/cli/rollout/*.jsonl` | `ZCODE_HOME` |
| Claude Code | `~/.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR` |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | `CODEX_HOME` |
| OpenCode | `~/.local/share/opencode/opencode.db`，数据库不存在或不可读时回退 `~/.local/share/opencode/storage/message/**/*.json` | `OPENCODE_PATH` |
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
toksight quota        # Codex 与 Kimi Code 的订阅额度窗口
toksight reset-prices # 清除旧单价、历史与缓存，再打开 Web 重新建库
toksight export-db backup.sqlite  # 导出完整的已提交用量数据库
toksight import-db backup.sqlite  # 合并备份并去重
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
codex   GPT-5.6 Sol         62   183K    1.79M        0   25.7K  90.8%    $1.96
zcode   GLM-5.3 Flash      487  2.51M   28.45M        0    442K  91.9%    $1.45
zcode   GLM-5.3             41   116K    1.99M        0   43.3K  94.5%   $0.870
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
--offline        跳过联网价格拉取，使用已保存的本地价格（quota：不请求 Kimi）
--no-color       关闭 ANSI 颜色
```

带值参数支持两种写法：`--since 2026-08-01` 与 `--since=2026-08-01`。

CLI 按天分组和日期过滤使用**本地时区**。网页可在设置里单独调整统计时区。

### 订阅额度

`toksight quota` 显示 Codex 与 Kimi Code 订阅当前的限流窗口：

```
Client     Plan                         Window               Used  Resets
─────────  ───────────────────────────  ──────  ─────────────────  ────────────────────────────
Codex CLI  self_serve_business_prolite  week                   4%  2026-11-02 00:46 (in 6d 17h)
Kimi Code  LEVEL_INTERMEDIATE           5h        69.5% (139/200)  2026-10-26 09:33 (in 2h 33m)
Kimi Code  LEVEL_INTERMEDIATE           week    10.4% (214/2,048)  2026-10-30 07:23 (in 4d)
Kimi Code  LEVEL_INTERMEDIATE           month                0.6%  2026-11-16 16:00 (in 21d 9h)

Codex CLI: from local session logs, last seen 2026-10-26 06:16 (43m ago)
```

- **Codex** 离线读取 `~/.codex/sessions`（支持 `CODEX_HOME`）中最新的 `rate_limits`。窗口按长度命名
  （`5h`、`week`，其他如 `2d`）；部分套餐只有周窗口。重置时间已过的窗口显示为已重置，不显示过期百分比。
- **Kimi Code** 本地没有额度数据，`toksight quota` 会读取 `~/.kimi-code/credentials/kimi-code.json`
  （支持 `KIMI_CODE_HOME`）中的访问令牌，请求 `GET https://api.kimi.com/coding/v1/usages`。令牌只发往
  Kimi 的 API 主机，不会打印或保存；toksight 不刷新令牌，过期时请打开 Kimi Code 刷新后重试。
- `--client codex` / `--client kimi` 限定客户端，`--offline` 跳过 Kimi 请求，`--json` 输出
  `{ tool, version, generatedAt, quotas }`。

网页今日概览的“订阅额度”卡片显示同样的数据。只有点击“刷新 Kimi 额度”（`POST /api/quota/refresh`）
才会查询 Kimi Code；`GET /api/quota` 只读本地数据。

## 定价

首次启动 Web 会引导建立**本地价格库**，保存在 toksight 自己的 `usage.sqlite`。
公开价格统一使用默认启用的 [LiteLLM 模型价格表](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)，
仅收录第一方模型提供商：OpenAI、Anthropic、Google、DeepSeek、Moonshot、Z.AI、Mistral/Codestral、
xAI、MiniMax、Alibaba/Qwen、Cohere 和 AI21。

筛选同时检查提供商元数据和模型归属。Google 使用 Gemini API 价格表；不收录市场、聚合商和转售报价，
Mistral、Alibaba 托管的第三方模型也会排除。提供商别名归一到原厂计价渠道；未知提供商或没有有效 token
单价的模型保持未定价。

可以立即建库，也可使用已保存价格和用户覆盖本地继续。LiteLLM 数据在
`<toksight-dir>/cache/litellm-pricing.json` 缓存 7 天；`--offline` 使用已有价格且不联网。
引导与自动更新偏好保存在数据库中，不依赖浏览器。更新价格不扫描 Agent 文件。

单价变化按本机观察时间保存。请求使用其时间戳之前最后一次观察到的价格；早于首次观察的请求使用
最早已知价格作参考。单价不变不新增历史版本。SQLite 备份保留历史，但无法补全本机未更新期间错过的调价。

**用户覆盖**优先级最高。编辑 `<toksight-dir>/pricing.json`（单位：美元 / 百万 token）：

```json
{
  "my-model": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }
}
```

名称先精确匹配，也接受无歧义的提供商后缀（例如 `zhipuai/glm-5.3` 可覆盖 `GLM-5.3`）。
查价先匹配原始目录 ID，再尝试归一化别名。带日期快照保留各自价格；去日期的别名必须对应目录原名，
或同模型、同提供商的候选价格完全一致。微调模型前缀保持独立。

Codex 会话提供商、OpenCode 消息提供商、能安全关联到用量的 Kimi 请求提供商和 ZCode rollout 提供商
会保留。自定义 Agent 提供商可以通过 `<toksight-dir>/providers.json` 绑定原厂 API 参考价：

```json
[
  { "client": "codex", "providerId": "myproxy", "provider": "openai", "since": "2026-10-01T00:00:00Z" }
]
```

绑定可选 `model`、包含起点的 `since`、不包含终点的 `until`；时间必须带时区。同等具体程度的重叠绑定
不推断。编辑后刷新用量或更新价格。未知自定义提供商需要绑定或 `pricing.json` 覆盖；不会用今天的
Agent 配置倒推全部历史。绑定使用原厂 API 参考价，不代表中转商报价。

Kimi Code 的版本化 ID `kimi-code/k3`、`kimi-code/k3-256k` 按官方
[模型对应关系](https://www.kimi.com/code/docs/kimi-code/models.html)匹配 `moonshot/kimi-k3` 参考价，
原始用量 ID 不变。同来源内端点原名价格优先，用户覆盖始终优先。需要 Moonshot 目录价格或用户覆盖。
这是 API 参考估算，不代表 Kimi Code 订阅实付或套餐额度。`kimi-code/kimi-for-coding` 等滚动 ID
只有明确价格时才计价，不推断其历史底层模型。

LiteLLM 标准长上下文字段（如 `*_above_200k_tokens`）和 Qwen 的 `tiered_pricing` 范围表，
按单次请求的新鲜输入 + 缓存读取 + 缓存写入选档，
不计输出；越过的最高阈值决定整次请求的单价，xAI 的阈值包含边界。档位缺少输出或缓存价时沿用已公布
基础价；基础缓存价也缺失时退回所选档位输入价。范围表按 `(start, end]` 选档，32,000 token 留在第一档；
每档缺少缓存价时使用该档输入价。不推断缓存时长和服务档位调整。自报金额与用户覆盖保持优先。

同一原始模型 ID 跨多个实际单价时，`pricing.modelRates` 标记 `variableRates` 并省略单一单价。
每条请求按原始 ID 定价后再做展示归并。数据库保存提供商、原始目录名、美元 / token 单价与上下文档位，
`price_updates` 保存拉取 / 检查状态；备份保留符合筛选条件的价格和历史。

`<toksight-dir>` 优先取 `TOKSIGHT_CONFIG_DIR`，其次 `$XDG_CONFIG_HOME/toksight`，否则为 `~/.config/toksight`。
查不到价格的模型照常统计 token，费用显示 `—`，并列入 `pricing.unpricedModels`。
OpenCode SQLite 的 `cost: 0` 是占位，仅非零数据库费用视为自报金额；旧 JSON 数值费用照录。
LiteLLM 缺少独立缓存价格时按输入价估算，`costCoverage.cacheFallbackRequests` 统计受影响请求；这可能高估缓存读取费用。
参考估算不等于历史账单或订阅账单。

## 网页仪表盘

`toksight web` 启动一个小型本地服务器（零依赖 `node:http`），托管静态导出的
[Next.js](https://nextjs.org) 仪表盘和 JSON API，并打印地址
（默认 `http://127.0.0.1:4729`）。加上 `--open` 会用浏览器打开该地址。默认只绑定本机回环地址。
首次启动会扫描 Agent 文件并创建 `<toksight-dir>/usage.sqlite`。以后启动会预读取数据库，
普通报告和单日请求使用已提交的快照，不会重新扫描 Agent。
默认回环绑定让报告请求留在本机；修改 `--host` 可能使其他网络客户端访问报告 API。

点击报告上方的**刷新**按钮、调用 `POST /api/refresh`，或运行 `toksight refresh`，会重新扫描所有 Agent，
并在一个事务中更新数据库。刷新失败时保留旧快照；网页服务器也会发现其他 toksight 进程写入的
新快照。刷新后报告与已加载的单日详情一同更新，页脚显示数据库上次刷新时间。
`toksight refresh --offline` 可跳过价格拉取。

**设置**中的**导出数据库**会下载独立的 `.sqlite` 备份，包含所有 Agent、所有日期的已提交用量，
不受当前报告周期或启动筛选影响。备份包含会话标题与目录、导入用量、价格和费用来源；
不包含 Agent 原始文件、凭据或浏览器偏好。需要收录最新会话时先刷新再导出。
**导入数据库**接受 toksight 的 `.sqlite` 或 `.db` 文件（最大 256 MB），展示合并说明后，
在事务中导入。无效或不兼容的数据库不会改变已有数据。结果展示新增、更新和重复数量，
报告跳转到备份最新用量所在周期。

导入采用**合并去重**，不会替换目标数据库。用量记录按 Agent、会话 ID、时间戳、模型和
token 数匹配，相同请求在不同备份中取最大出现次数，目录与标题不影响匹配。
已有上报费用及冲突价格优先保留，上报费用可以补全原有估算。
用量字段发生变化时无法确定是同一请求，可能再次计入。导入历史在刷新后继续保留，
也会出现在 CLI 报告中，并可再次导出。估算费用会随本机价格更新而变化。

CLI 提供 `toksight export-db <文件>` 与 `toksight import-db <文件>`，加 `--json` 输出传输统计。
导出需要已有快照（先运行 `toksight refresh` 创建），且不会覆盖已有文件。传输命令不接受日期或 Agent 筛选。
网页接口为 `GET /api/export/db`（下载 SQLite）和 `POST /api/import/db`（上传原始 SQLite 字节，
返回 JSON 合并统计）；两者均保留本机 Host 检查，导入还需通过来源检查。
导入导出支持离线操作，不会写入 Agent 文件。

价格页顶部、“更新单价”旁的**重置价格库**会清除已保存的单价、价格观察历史、LiteLLM 下载缓存以及快照和导入记录中的价格回退值，
弹窗说明清除范围，执行中禁止重复操作，失败可在弹窗内重试；确认成功后返回首次建库引导。可选择重新下载公开价格，或使用自定义定价本地继续。
历史估算费用会重新计算；用量、自报费用、数据库导入、已选价格来源、`pricing.json` 和
`providers.json` 均保留。重置的是共享 `usage.sqlite` 内的价格数据，不删除用量数据库文件。
如需保留价格历史，可先导出数据库备份。

CLI 对应命令是 `toksight reset-prices`，支持 `--json` 和离线执行，之后运行 `toksight web` 重新建库；
不接受日期或 Agent 筛选。运行 CLI 重置前请关闭其他 toksight 进程。
Web 使用 `POST /api/prices/reset`，返回 `completed: false` 的引导状态；
该服务正在刷新或更新价格时返回 HTTP 409。重置本身不扫描 Agent，也不联网。

报告上方的**更新单价**按钮调用 `POST /api/prices/update`，由本机下载 LiteLLM 价格，
不受 7 天更新间隔限制。左侧**价格**页显示本地目录、来源获取时间，以及输入、输出、缓存读写单价
（美元 / 百万 tokens）。可以搜索模型、按提供商筛选，点击模型查看原始 ID、上下文档位与
本机观察到的价格历史，并在该页调整自动更新。浏览价格只读取本地数据库。
开启后，服务每小时及启动/报表读取时检查，来源过期才更新，失败隔一小时重试；服务关闭即停止。
新价格按适用请求时间重算费用，不重扫用量，也不覆盖自报金额。`--offline` 禁止网络更新。
首次引导选择本地继续时，首次自动检查推迟一小时。
`GET /api/prices/status` 返回引导和更新状态；`POST /api/setup` 完成引导或修改自动更新偏好，
`GET /api/prices` 返回目录，加 `key=<记录 id>` 读取该项价格历史（从新到旧）。API 单价仍为美元 / token。
这些接口遵守已有 Host/Origin 检查。

新版前端位于 `frontend/`，参考 [ATK HUB](https://hub.atk.pro/) 的工作台设计：冷灰底色、独立顶部工具栏、
可收起灰色侧栏、半透明中性灰面板、黑白控件与少量橙色重点；深色使用近黑背景。网页默认打开**今天**，侧栏提供**今天、日历、价格、设置**。
顶部可切换浅色 / 深色 / 跟随系统与中文 / EN；手机使用吸附顶栏和横向导航。页首提供**刷新数据库**和**导出图片**，
**更新单价**集中在价格页。完整视觉规范见 `design-spec.md`。

- **今天**：突出 Tokens 与参考费用，缓存命中率和请求数作为辅助指标；再展示可切换 Tokens / 费用的小时分布、Token 构成环图、可展开模型的 Agent 表
  和最多十条会话（默认展示五条，可展开）。有昨日基数时展示对比昨日全天的用量 / 费用变化。单模型 Agent 直接标明模型名，任一 Agent 使用多个模型时才展示独立模型排行。
  图表标明数量刻度，小时峰值同时显示时间和用量。可以筛选全部或单个 Agent。会话包含标题、用量、费用、起止时间、
  活跃时长、目录和模型。
- **日历**：热力日历与所选日期详情直接展开，宽屏左右排列，窄屏上下排列。单击日期或用键盘激活就能
  切换详情，‹ / › 逐日移动；不再使用弹层、拖动卡片或分页卡片堆。保留月 / 年导航、月份直达、
  **1D / 7D / MTD / 30D**、包含首尾日期的自定义范围和 Agent 筛选。范围总量提前到日历顶部；窄屏选择日期
  会定位到紧接日历的详情，可用“返回日历”回到所选格，趋势排在详情之后并提供快捷入口。
  窄格用较短的数字缩写，日期标签和提示保留完整格式。短范围用日历，长范围按年分组周网格；趋势单日按小时、最多 62 个已过
  日期按日、更长范围按月汇总，缺失日期补零。
- **设置**：调整外观、语言和统计时区，导入 / 导出完整数据库。

统计时区默认自动读取浏览器，也可手动选择，例如系统设为美国时间时选 `Asia/Shanghai`。
今天、日期边界、小时归属和显示时间都使用所选时区，时钟变化自动处理，界面始终采用统一的日视图。
偏好保存在当前浏览器。今天与滚动范围跨午夜自动更新，回到浏览器或点击刷新也会重新读取日期。
修改统计时区不会改变 Agent 记录或 CLI 的日期口径。

Tokens 与费用始终同时显示。点击 Tokens / 费用表头切换排序，点击 Agent 行展开模型；每行的 ⓘ 按钮支持
点击或 Enter / 空格展开 token 构成、请求、会话与匹配单价，窄屏隐藏的列也能完整查看。悬停提示保留。
单个 Agent 超过八个模型时，第八行合并显示剩余模型。
配色、语言、时区、日历模式和表格排序保存在 `localStorage`；日期和 Agent 筛选只在页面内存保存，
重载回到今天。日历里的重置会回到当月和全部 Agent。

**导出图片**将当前 Today 报告，或日历范围与所选单日详情，合成一张 PNG，包含日期、Agent、时区和页脚，
去掉操作控件和临时行内明细。已展开的模型会进入图片；数据尚未加载完成时禁用导出。费用混合上报金额与估算值，
不等于订阅账单；未定价模型仍列在页脚。前端继续静态导出并使用本地 API。

启动参数（`--client`、`--since`、`--until`、`--today/--week/--month`）限定服务的可见
范围，网页报告不会越过这个范围。

API 可以这样调用：`GET /api/data?period=custom&since=2026-09-01&until=2026-09-30`（报告本身
就这样请求，单日详情也用同样方式请求某一天）或 `?client=claude&period=7d`。`period` 可为 `all`（默认）/ `today` / `7d` /
`30d` / `month` / `custom`（须同时给出 `since` 与 `until`）；`since` / `until` 可单独使用；
预设周期不能与显式日期混用。可选的 `timezone=Asia%2FShanghai` 按 IANA 时区解释日期筛选和所有日历 / 小时统计，
不传时保持服务端本地时区。未知、重复或无效参数返回 HTTP 400。`POST /api/refresh`
会更新数据库，并返回刷新时间、记录数和采集警告；网页 API 新增的 `snapshot` 字段包含刷新时间和记录数。
`POST /api/prices/update` 不扫描用量，由本机更新公开价格来源。
`GET /api/quota` 返回本地额度数据，`POST /api/quota/refresh` 还会查询 Kimi Code。
跨来源写入请求会被拒绝。

### 仪表盘构建产物

`frontend/` 是唯一的前端源码、依赖、构建与发布目录；旧 `web/` 已移除。
推荐 `npm run frontend:ci`、`npm run frontend:dev`、`npm run frontend:build`；原 `web:*` 命令仍兼容，均指向新版。

npm 包已包含 `frontend/out/` 中预构建好的静态文件——安装后直接 `toksight web` 即可，无需构建，
也不运行 Next。从源码预览发布版页面需要 Node >=22.5：

```bash
npm run web:ci && npm run web:build && node bin/toksight.js web
```

`frontend/out/` 尚未构建时，`toksight web` 会在 `/` 显示构建指引页，`/api/data` 不受影响；
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
SQLite 数据库，价格抓取可能更新本地缓存；toksight 不会上传用量数据，也不会写回 Agent 文件。
如果修改 `--host`，同一网络中的其他客户端可能读取报告和 API。
外部请求用于下载 LiteLLM 价格表；`--offline` 可关闭联网价格请求。`toksight quota` 与网页的“刷新 Kimi 额度”
按钮还会用本机 Kimi Code 令牌请求 Kimi Code 用量 API。
报告图片在浏览器里生成，只保存到你下载的位置。

## JSON 输出

报告命令支持 `--json`（如 `toksight daily --json`）。结构包含：`totals`、`cacheHitRate`、
`clients`、`models`、`daily`、`monthly`、`sessions`、`pricing`（含 `unpricedModels`）、`warnings`。
`clients` 的每一项是该 Agent 的 totals 外加它自己的 `cacheHitRate`；该映射由**过滤后**的
entries 构建，`--client` / `--since` / `--until` 对它与其余切片一样生效。
`models` 按 Agent 和展示名称分行，`modelIds` 列出原始 ID；`pricing.modelRates` 保留
每个 ID 的单价细节。名称合并不会改变逐条请求算出的费用。
`toksight refresh --json` 则返回数据库路径、刷新时间、记录数和采集警告。
`toksight quota --json` 返回 `{ tool, version, generatedAt, quotas }`；每项包含 `client`、`plan`、`source`
（`local`/`api`）、`fetchedAt`、`observedAt`、`windows`（`id`、`label`、`windowMinutes`、`usedPercent`、可选的
`used`/`limit`/`remaining`、`resetsAt`、`reset`）以及可选的 `error` `{ code, message }`。

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

日常开发和开发 PR 使用 `dev`；`release` 是仓库默认分支，接收发布及维护 PR。
开发提交通过 `git push origin dev` 推送，准备发布时再向 `release` 发起 PR。

```bash
npm test              # node:test 套件 + 各客户端 fixture（无需联网）
node bin/toksight.js  # 从源码直接运行
npm run web:ci        # 按 frontend/package-lock.json 安装锁定的网页依赖
npm run web:dev       # 同时启动 API（4729）和前端（3000），支持热更新
```

打开 `http://127.0.0.1:3000`，无需提前构建 `frontend/out/`；Ctrl+C 一起关闭前后端，端口被占用
会报错并关闭本命令启动的服务。`npm run web:dev -- --port 3001 --api-port 4730 --offline`
可覆盖两个端口并关闭价格拉取。需要分开管理时，在仓库根目录用两个终端分别跑
`node bin/toksight.js web --api-only` 与 `npm run web:dev:ui`（代理目标可用
`TOKSIGHT_DEV_API` 覆盖，仅影响开发服务器，生产构建始终输出静态文件）。
`web:install` 保留给需要更新网页依赖的开发者。

仓库的 [`.codex/config.toml`](./.codex/config.toml) 已配置项目级 Playwright MCP，供 Codex 操作浏览器。
信任项目并重新启动 Codex 会话后，可用 `/mcp` 查看服务。
安装与使用步骤见[开发指南](./doc/development-release.md#playwright-mcp)。

CLI 本体保持**零运行时依赖**，仪表盘依赖只存在于 `frontend/package.json`，仅在（重新）构建
`frontend/out/` 时需要。数据流程：会话文件 → 解析器 → `collectAll` → CLI 输出或 SQLite 刷新 → `/api/data`；
`frontend/` 源码 → Next 构建 → `frontend/out/` → CLI 内置 HTTP 服务器。架构、数据契约与维护说明按主题收录在
[doc/README.md](./doc/README.md)；精简的 Agent 规则见 [AGENTS.md](./AGENTS.md)。

```bash
npm run check:package  # 打包并在临时目录离线安装，再用 fixture 验证页面、静态资源与数据 API
```

仅安装锁定的网页依赖时需要网络；全程使用临时 Agent fixture，不碰真实数据，结束后
自动清理。PR 和 dev 的 CI，以及 Release 工作流，会在 Ubuntu/Windows 上运行测试与该检查。

### 发布

向 `release` 发起 PR，同时提交要发布的代码和明确的稳定版号。例如运行
`npm run release:version -- 1.1.0`，可同步更新两个 manifest 和两个 lockfile。
PR CI 会检查版本一致性、测试和安装包。合入后 Release 工作流重跑检查，
再将相同版本发布到 npm 和 GitHub Releases。版本号不变的 PR 不会发版。
合入 `release` 后，将 `origin/release` 合回 `dev` 并推送，保持开发分支同步。

分支保护、npm Trusted Publishing 配置、失败重试和验收方法见[发布指南](doc/release.md)。

### 路线图

- [x] 网页仪表盘（`toksight web`，第二阶段）
- [x] 今天 / 日历 / 价格 / 设置工作空间，可调整时区并导出图片（`toksight web`）
- [ ] TUI watch 模式
- [ ] 更多客户端（Windsurf、pi……）
- [ ] `--export csv`、排行榜式分享

## 许可

MIT。与智谱 AI、Anthropic、OpenAI 及各智能体厂商均无关联。
