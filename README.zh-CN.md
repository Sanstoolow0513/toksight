# 🔭 toksight

**在终端里追踪 AI 编程智能体的 token 用量、成本和缓存命中率。**

toksight 读取各 AI 编程智能体已经写在本地磁盘的会话文件，也可导入 Cursor 用量 CSV，输出总量、按模型 / 按天 / 按会话的
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
| Cursor | 从 Cursor 导出的用量 CSV，经 `toksight web` 导入 | `TOKSIGHT_CONFIG_DIR`（导入数据存储位置） |

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
--client <a,b>   只统计指定客户端（zcode, claude, codex, opencode, kimi, cursor）
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
--offline        跳过 LiteLLM 与 Cursor 价格拉取
--no-color       关闭 ANSI 颜色
```

带值参数支持两种写法：`--since 2026-08-01` 与 `--since=2026-08-01`。

CLI 按天分组和日期过滤使用**本地时区**。网页可在设置里单独调整统计时区。

## 定价

除 Cursor 外，未使用 Agent 自报费用的请求按 token 数和三层价格计算（后者覆盖前者）：

1. **内置价格表** — 明确列出的模型的最佳努力估算（美元 / 百万 token），离线可用；新版本和变体不会沿用同系列旧型号的价格。
2. **LiteLLM** — 从社区[模型价格库](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)拉取，
   本地缓存 7 天（`<toksight-dir>/cache/litellm-pricing.json`）；`--offline` 可读取已有缓存且不发网络请求。
3. **用户覆盖** — 编辑 `<toksight-dir>/pricing.json`（单位：美元 / 百万 token）：

   ```json
   {
     "my-model": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 }
   }
   ```

   模型名支持精确匹配或无歧义的提供商后缀匹配（`zhipuai/glm-5.3` 也可匹配 `GLM-5.3`）。

每个价格来源内，先按原始目录 ID 精确匹配，再尝试归一化别名。带日期的版本保留各自单价；
去掉日期后的别名只有能对应目录原名，或同模型、同提供商的候选价格完全一致时才接受。
提供商前缀依据目录元数据匹配，微调模型前缀保持独立。
LiteLLM 的标准长上下文字段（如 `*_above_200k_tokens`）按单次请求的新鲜输入 + 缓存读取 +
缓存写入选择，不计输出；采用已越过的最高阈值对应单价计算整次请求，xAI 直连接口包含阈值边界。
档位未提供输出或缓存单价时沿用已公布的基础价；基础价也未提供缓存价格时，退回所选档位的输入价。
不推断缓存时长和服务档位的加价或折扣；用户覆盖和自报费用继续优先。
同一模型 ID 跨多个单价时，`pricing.modelRates` 标记 `variableRates` 并省略单一单价。
上下文价格随 SQLite 备份和离线导入保留；已有 Web 快照在下次更新单价或刷新用量时补齐这些元数据。

`<toksight-dir>` 优先取 `TOKSIGHT_CONFIG_DIR`；未设置时，取 `$XDG_CONFIG_HOME/toksight`，
再退到 `~/.config/toksight`。
查不到价格的模型照常计数，成本显示为 `—`，并在 JSON 输出的 `pricing.unpricedModels` 中列出。
OpenCode SQLite 中的 `cost: 0` 是占位值，仅非零自报费用优先；旧版 JSON 中的数值费用按上报值保留。
Cursor CSV 的 `Included` 行会使用 Cursor 官方
[Models & Pricing](https://cursor.com/docs/models-and-pricing) Markdown 总表，并从官方
[文档索引](https://cursor.com/docs/llms.txt)自动发现模型详情页，读取 HTML 价格表及模型 ID。
模型名、别名、Fast 和明确标出的长上下文档位来自下载的目录，不维护模型家族白名单。
输入、缓存写入、缓存读取和输出单价用于计算**参考费用**，计入费用总额及排行；它并非实际扣费。
CSV 中的数字费用及 `Free` 始终按原值使用。`Included` 行如果查不到 Cursor 单价（如无法确定
实际路由模型的 `Auto`）才保持未定价。Cursor 单价在 `<toksight-dir>/cache/cursor-pricing.json` 缓存 7 天；
`--offline` 可使用已有缓存。`pricing.sources.cursor` 标明缓存状态，网页的
`costCoverage.sources.cursor` 单独列出这部分估算。表中明确标为 `Long Context (>N)` 的档位，
按每次请求的新鲜输入 + 缓存读取 + 缓存写入选择；同一原始模型 ID 跨多个单价时，不显示单一
单价提示，JSON 标记 `variableRates`。详情页失败时保留可用总表/缓存价格并报警；已抓取但本次
缺失的模型保留最后已知价格及原抓取日期（`pricing.modelRates` 的 `retained` / `priceFetchedAt`）。
历史记录按获取到的公开价格折算；过往套餐价格、未公布的上下文规则、地区加价及套餐专属费用
等条件仍可能让参考费用与实际用量价值不同。
旧版本导入时没有保存 CSV 的 Cost 标签，数据库升级后会将旧记录中的未知费用按 `Included` 处理。
网页快照会把两个来源的单价归一化保存到 toksight 自己的 `usage.sqlite` 的 `model_prices` 表，
保留价格来源、计费范围、原始目录名称、美元 / token 单价和上下文价格元数据。`price_updates` 记录各来源上次成功拉取
及检查时间。Cursor 只使用 Cursor 计费范围内的价格；例如 CSV 中的
`cursor-grok-4.6-xhigh-fast` 会匹配 `grok-4.6-fast`，`xhigh` 单独记录为 effort；
`opus5.5-high` 会匹配 Claude Opus 5.5 官网单价。匹配优先采用目录中最完整的模型名/ID，
再识别多出的执行模式词（`low`、`medium`、`high`、`xhigh`、`thinking`、`max`）；省略品牌的
简写只有唯一匹配时才接受。歧义或未知名称保持未定价及原显示名。Max 模式因此归入基础模型，
而官方单列的 Max 模型自动保持独立；Fast、500k 仍需各自的目录价格。新模型随单价更新接入，
无需改代码或重传 CSV；Cursor 模型行使用匹配到的官方名称，自报费用记录也使用同一目录归并。
CSV 的 `Max Mode` 列保存为记录中的可选 `cursorMaxMode` 元数据
（true/false，未知为 null）；重导可补齐或更正，不重复计数，也不覆盖已知的自报费用。
旧记录需要重导才能补齐该列。模型名中的 Max 模式在内部与推理 effort 分开保留；它不能确定
当时的套餐，因此参考估算不会自动叠加旧套餐的 Max 附加费。
其他 Agent 依上述通用来源优先级取价。用现在的公开单价折算历史记录仍只是参考估算，
不是历史账单。每条请求按原始模型 ID 计价后，才按 Agent 和统一模型名汇总展示。
同一行的各原始 ID 单价相同时，模型行的悬停提示显示实际采用的美元 / 百万 token 单价；JSON 的
`pricing.modelRates` 保留原始 ID、effort 和单价。
官网缓存单价标为 `-` 时，对应 token 暂按输入单价折算；
`costCoverage.cacheFallbackRequests` 会统计受此影响的请求数。

当 LiteLLM 条目缺少独立的缓存价格时，toksight 按该模型的输入价估算缓存 token，
并在 `costCoverage.cacheFallbackRequests` 中标记受影响请求。真实缓存读取价较低时，
这一回退可能高估费用；有独立缓存价格的模型按其缓存价格计算。

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
不受当前报告周期或启动筛选影响。备份包含会话标题与目录、Cursor 导入记录、价格和费用来源；
不包含 Agent 原始文件、凭据或浏览器偏好。需要收录最新会话时先刷新再导出。
**导入数据库**接受 toksight 的 `.sqlite` 或 `.db` 文件（最大 256 MB），展示合并说明后，
在事务中导入。无效或不兼容的数据库不会改变已有数据。结果展示新增、更新和重复数量，
报告跳转到备份最新用量所在周期。

导入采用**合并去重**，不会替换目标数据库。非 Cursor 记录按 Agent、会话 ID、时间戳、模型和
token 数匹配，相同请求在不同备份中取最大出现次数，目录与标题不影响匹配。
已有上报费用及冲突价格优先保留，上报费用可以补全原有估算；Cursor 沿用 CSV 事件匹配规则。
用量字段发生变化时无法确定是同一请求，可能再次计入。导入历史在刷新后继续保留，
也会出现在 CLI 报告中，并可再次导出。估算费用会随本机价格更新而变化。

CLI 提供 `toksight export-db <文件>` 与 `toksight import-db <文件>`，加 `--json` 输出传输统计。
导出需要已有快照（先运行 `toksight refresh` 创建），且不会覆盖已有文件。传输命令不接受日期或 Agent 筛选。
网页接口为 `GET /api/export/db`（下载 SQLite）和 `POST /api/import/db`（上传原始 SQLite 字节，
返回 JSON 合并统计）；两者均保留本机 Host 检查，导入还需通过来源检查。
导入导出支持离线操作，不会写入 Agent 文件。

报告上方的**更新单价**按钮调用 `POST /api/prices/update`，同时检查 LiteLLM 和 Cursor，
不受 7 天自动更新间隔限制。启动及报表请求只会在某个来源距上次成功拉取至少 7 天时
自动检查；失败后隔一小时再试。页脚和 `pricing.updates` 显示各来源上次成功更新时间。
单价更新会重算已有估算，无需重新扫描用量，也不会覆盖 Agent 或 CSV 上报的金额。
`--offline` 禁止手动联网更新。

要加入 Cursor 历史，在 Cursor 导出 **Usage Events** CSV，打开 `toksight web`，点击设置中的
**导入 Cursor CSV**。文件只发送到本机 toksight 服务，用量记录保存在 `usage.sqlite`；
按时间、模型和 token 数匹配重复事件，费用标记或金额变化不会重复计入 token。导入结果会在刷新后保留，
也可在 CLI 用 `--client cursor` 查看。
零 token 的行会跳过。CSV 不包含会话 ID，因此 Cursor 不显示会话数与会话详情；其 `Cache Read`
列足以按现有口径计算缓存命中率。
Cursor 导出不含事件 ID：时间、模型及 token 数完全相同的两条真实事件，无法与跨文件重复行严格区分；
如果 Cursor 后续修订了模型名或 token 数，同一事件仍可能被再次计入。导入提示会显示匹配结果。

网页默认打开**今天**，侧边导航提供**今天、日历、设置**三个入口。顶栏与导航使用无点阵的灰色背景，
主内容区保留稀疏点阵和暖色明暗配色（视觉规范见 `design-spec.md`）。配色与中文 / EN 切换留在顶栏，
**刷新、更新单价、导出图片**位于报告上方。

- **今天**：先展示 Tokens、参考费用、缓存命中率和请求数，再展示小时分布、可展开模型的 Agent 表、
  跨 Agent 模型表和最多十条会话。可以筛选全部或单个 Agent。会话包含标题、用量、费用、起止时间、
  活跃时长、目录和模型。
- **日历**：热力日历与所选日期详情直接展开，宽屏左右排列，窄屏上下排列。单击日期或用键盘激活就能
  切换详情，‹ / › 逐日移动；不再使用弹层、拖动卡片或分页卡片堆。保留月 / 年导航、月份直达、
  **1D / 7D / MTD / 30D**、包含首尾日期的自定义范围和 Agent 筛选。日历下展示范围总量及用量 / 费用
  趋势，旁边展示所选单日统计。短范围用日历，长范围按年分组周网格；趋势单日按小时、最多 62 个已过
  日期按日、更长范围按月汇总，缺失日期补零。
- **设置**：调整统计时区，导入 / 导出完整数据库，导入 Cursor CSV。

统计时区默认自动读取浏览器，也可手动选择，例如系统设为美国时间时选 `Asia/Shanghai`。
今天、日期边界、小时归属和显示时间都使用所选时区，时钟变化自动处理，界面始终采用统一的日视图。
偏好保存在当前浏览器。今天与滚动范围跨午夜自动更新，回到浏览器或点击刷新也会重新读取日期。
修改统计时区不会改变 Agent 记录或 CLI 的日期口径。

Tokens 与费用始终同时显示。点击 Tokens / 费用表头切换排序，点击 Agent 行展开模型；悬停查看 token
构成、请求、会话与匹配的单价。单个 Agent 超过八个模型时，第八行合并显示剩余模型。
配色、语言、时区、日历模式和表格排序保存在 `localStorage`；日期和 Agent 筛选只在页面内存保存，
重载回到今天。日历里的重置会回到当月和全部 Agent。

**导出图片**将当前 Today 报告，或日历范围与所选单日详情，合成一张 PNG，包含日期、Agent、时区和页脚，
去掉操作控件。已展开的模型会进入图片；数据尚未加载完成时禁用导出。费用混合上报金额与估算值，
不等于订阅账单；未定价模型仍列在页脚。前端继续静态导出并使用本地 API。

启动参数（`--client`、`--since`、`--until`、`--today/--week/--month`）限定服务的可见
范围，网页报告不会越过这个范围。

API 可以这样调用：`GET /api/data?period=custom&since=2026-09-01&until=2026-09-30`（报告本身
就这样请求，单日详情也用同样方式请求某一天）或 `?client=claude&period=7d`。`period` 可为 `all`（默认）/ `today` / `7d` /
`30d` / `month` / `custom`（须同时给出 `since` 与 `until`）；`since` / `until` 可单独使用；
预设周期不能与显式日期混用。可选的 `timezone=Asia%2FShanghai` 按 IANA 时区解释日期筛选和所有日历 / 小时统计，
不传时保持服务端本地时区。未知、重复或无效参数返回 HTTP 400。`POST /api/refresh`
会更新数据库，并返回刷新时间、记录数和采集警告；网页 API 新增的 `snapshot` 字段包含刷新时间和记录数。
`POST /api/prices/update` 不扫描用量，只更新两种公开价格来源。
`POST /api/import/cursor` 接受最大 20 MB 的 UTF-8 Cursor 用量 CSV，并返回新增、费用更新、重复及跳过条数。
跨来源写入请求会被拒绝。

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
会先扣除缓存部分得到新鲜输入，让该公式在各 Agent 间口径一致。Cursor CSV 已区分新鲜输入、
缓存读取和缓存写入。

## 隐私

toksight 本地优先：CLI 与网页报告只**读取**各 Agent 的会话文件。刷新会写入 toksight 自己的
SQLite 数据库，价格抓取可能更新本地缓存；toksight 不会上传用量数据，也不会写回 Agent 文件。
Cursor CSV 导入数据同样存于这个数据库。
如果修改 `--host`，同一网络中的其他客户端可能读取报告和 API。
外部请求仅用于拉取 LiteLLM 公开价格，以及 Cursor 官方价格总表、模型索引和详情页；`--offline`
可关闭两种网络请求。
报告图片在浏览器里生成，只保存到你下载的位置。

## JSON 输出

报告命令支持 `--json`（如 `toksight daily --json`）。结构包含：`totals`、`cacheHitRate`、
`clients`、`models`、`daily`、`monthly`、`sessions`、`pricing`（含 `unpricedModels`）、`warnings`。
`clients` 的每一项是该 Agent 的 totals 外加它自己的 `cacheHitRate`；该映射由**过滤后**的
entries 构建，`--client` / `--since` / `--until` 对它与其余切片一样生效。
`models` 按 Agent 和展示名称分行，`modelIds` 列出原始 ID；`pricing.modelRates` 保留
每个 ID 的单价细节。名称合并不会改变逐条请求算出的费用。
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
`web/` 源码 → Next 构建 → `web/out/` → CLI 内置 HTTP 服务器。架构、数据契约与维护说明按主题收录在
[doc/README.md](./doc/README.md)；精简的 Agent 规则见 [AGENTS.md](./AGENTS.md)。

```bash
npm run check:package  # 打包并在临时目录离线安装，再用 fixture 验证页面、静态资源与数据 API
```

仅安装锁定的网页依赖时需要网络；全程使用临时 Agent fixture，不碰真实数据，结束后
自动清理。PR 与 main 分支的 CI 会在 Ubuntu/Windows 上运行测试与该检查。

### 发布

发布由 [.github/workflows/release.yml](.github/workflows/release.yml) 自动完成：推送一个与
`package.json` 版本一致的 `v*` 标签，工作流会先跑完整测试矩阵（Ubuntu + Windows，Node
22/24）与 Ubuntu/Windows 的 Node 22 安装包检查，校验标签与包版本一致，然后用自动生成的变更记录创建 GitHub Release。

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
- [x] 今天 / 日历 / 设置工作空间，可调整时区并导出图片（`toksight web`）
- [ ] TUI watch 模式
- [ ] 更多客户端（Windsurf、pi……）
- [ ] `--export csv`、排行榜式分享

## 许可

MIT。与智谱 AI、Anthropic、OpenAI 及各智能体厂商均无关联。
