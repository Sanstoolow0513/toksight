# 🔭 toksight

**在终端里追踪 AI 编程智能体的 token 用量、成本和缓存命中率。**

toksight 读取各 AI 编程智能体已经写在本地磁盘的会话文件，输出总量、按模型 / 按天 / 按会话的
统计以及成本估算。纯 Node.js CLI，零运行时依赖。第一阶段只做统计展示，没有 TUI。

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
| Gemini CLI | `~/.gemini/tmp/*/chats/*.json` | `GEMINI_CLI_HOME` |

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
toksight env          # 查看检测到的数据源与定价状态
```

示例输出（`toksight`）：

```
Tokens 3,668,215  Cost $0.378  36 requests · 1 sessions
input 1.87M · cache read 1.74M (48.2% hit · write 0) · output 55.9K
range: all time · clients: all

By client
Client  Req  Sessions  Tokens    Cost
──────  ───  ────────  ──────  ──────
zcode    36         1   3.67M  $0.378

Top models (up to 20)
Client  Model          Req  Input  Cache R  Cache W  Output    Hit     Cost
──────  ─────────────  ───  ─────  ───────  ──────  ──────  ─────  ───────
zcode   GLM-5.3-Flash   35  1.86M    1.74M        0   55.8K  48.4%   $0.359
zcode   GLM-5.3          1  13.8K        0        0     126   0.0%  $0.0199
```

### 参数

```
--client <a,b>   只统计指定客户端（zcode, claude, codex, opencode, gemini）
--since <date>   本地日期（YYYY-MM-DD），含当天
--until <date>   本地日期（YYYY-MM-DD），含当天
--today --week --month   日期快捷方式
--top <n>        models/sessions 表格行数上限（默认 20）
--json           输出机器可读 JSON
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

### 缓存命中率

`cacheRead / (新鲜输入 + cacheRead)` — 即提示词 token 中由缓存服务的比例。缓存**写入**不计入
分母（那是被存储的冷数据，不是被服务的流量）。

## 隐私

toksight 是本地优先的：只**读取**你机器上的会话文件，绝不上传数据。唯一的网络请求是匿名的
LiteLLM 价格拉取；`--offline` 可以连它也关掉。

## JSON 输出

所有命令都支持 `--json`（如 `toksight daily --json`）。结构包含：`totals`、`cacheHitRate`、
`clients`、`models`、`daily`、`monthly`、`sessions`、`pricing`（含 `unpricedModels`）、`warnings`。

## 开发

```bash
npm test              # node:test 套件 + 各客户端 fixture（无需联网）
node bin/toksight.js  # 从源码直接运行
```

```
bin/toksight.js        可执行入口
src/cli.js             参数解析、子命令、渲染
src/clients/           每个 agent 一个解析器，归一化为统一数据结构
src/pricing.js         内置价格表 + LiteLLM 缓存 + 用户覆盖
src/aggregate.js       分组与合计
src/format.js          ANSI 表格与数字格式化
```

### 路线图

- [ ] TUI 仪表盘与 watch 模式（第二阶段）
- [ ] 更多客户端（Cursor、Windsurf、pi……）
- [ ] `--export csv`、排行榜式分享

## 许可

MIT。与智谱 AI、Anthropic、OpenAI 及各智能体厂商均无关联。
