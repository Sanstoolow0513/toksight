# 🔭 toksight

[English](./README.md) · [安装](#安装) · [使用](#使用) · [网页报告](#网页报告)

在终端查看 AI 编码 Agent 的 token 用量、参考费用和缓存命中率，也可以打开本地网页，查看哪些 Agent、模型和会话用量最多。

## 支持的客户端

支持 Claude Code、Codex CLI、Gemini CLI、Antigravity CLI、Kimi Code、OpenCode 和 ZCode。运行 `toksight env` 可查看各客户端的历史记录目录。

<details>
<summary>查看筛选 ID、默认目录和环境变量</summary>

| 客户端（筛选 ID） | 默认用量来源 | 目录环境变量 |
| --- | --- | --- |
| Claude Code（`claude`） | `~/.claude/projects/**/*.jsonl` | `CLAUDE_CONFIG_DIR` |
| Codex CLI（`codex`） | `~/.codex/sessions/` 和 `~/.codex/archived_sessions/` 下的 `.jsonl`、`.jsonl.zst` | `CODEX_HOME` |
| Gemini CLI（`gemini`） | `~/.gemini/tmp/<项目>/chats/`，macOS 还读取 `~/.cache/.gemini/tmp/<项目>/chats/` | `GEMINI_CLI_HOME`（两处路径的基目录） |
| Antigravity CLI（`antigravity` 或 `agy`） | `~/.gemini/antigravity-cli/brain/<会话>/.system_generated/logs/` | `ANTIGRAVITY_CLI_DIR` |
| Kimi Code（`kimi`） | `~/.kimi-code/sessions/**/agents/*/wire.jsonl` | `KIMI_CODE_HOME` |
| OpenCode（`opencode`） | `~/.local/share/opencode/opencode.db`，无法读取时使用 `storage/message/` | `OPENCODE_PATH` |
| ZCode（`zcode`） | `~/.zcode/cli/db/db.sqlite`，无法读取时使用 `cli/rollout/` | `ZCODE_HOME` |

</details>

Gemini CLI 和 Antigravity CLI 支持在 npm v1.4.0 发布后加入。在 `dev` 分支的源码目录运行 `node bin/toksight.js --client gemini,agy` 可查看两者的用量。

## 安装

需要 Node.js 22.x 的 22.15 及以上版本，或 Node.js 23.8 及以上版本。

```bash
npx toksight             # 一次性运行
npm install -g toksight  # 全局安装
```

## 使用

```bash
toksight                           # 总用量、各 Agent 用量和主要模型
toksight daily --week              # 最近七天的每日用量
toksight monthly --client codex    # Codex 的月度汇总
toksight models --today            # 今天各模型的用量
toksight sessions --month --top 5  # 本月参考费用最高的五个会话
```

用 `--client claude,codex` 可合并查看多个 Agent。查看指定日期范围时，使用 `--since YYYY-MM-DD` 和 `--until YYYY-MM-DD`，按本地时区统计，包含起止两天。完整命令和参数见 `toksight --help`。

## 定价

优先使用 Agent 上报的费用，其余请求按自定义单价或 LiteLLM 收录的第一方 API 单价估算。未定价模型仍计入 token 总量，参考费用可能与订阅账单不同。

在网页的**价格**页点击**更新单价**可获取新价格。使用 `--offline` 则只读取本地价格。要覆盖某个模型的单价，在 `~/.config/toksight/pricing.json` 中填写**每百万 token 的美元价格**：

```json
{ "my-model": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 } }
```

如果设置了 `XDG_CONFIG_HOME`，文件位于 `$XDG_CONFIG_HOME/toksight/` 下。也可用 `TOKSIGHT_CONFIG_DIR` 指定配置目录。[自定义提供商配置](https://github.com/Sanstoolow0513/toksight/blob/release/doc/local-pricing.md)

## 网页报告

运行 `toksight web --open`，即可在浏览器打开 `http://127.0.0.1:4729`。

| 想看什么 | 怎么操作 |
| --- | --- |
| 今天的用量分布 | **今天**页显示 token、费用、缓存命中率和会话，展开 Agent 可查看各模型用量。 |
| 其他日期或区间 | 在**日历**中点击一天或拖选多天，查看该时段的汇总与会话。 |
| 分享报告 | 点击**导出图片**，将当前的今天页或日历视图保存为 PNG。 |
| 最新会话 | 点击**刷新**或运行 `toksight refresh`。统计时区可在**设置**中调整。 |

缓存命中率表示提示词中有多少 token 来自缓存，计算方式为 `缓存读取 /（新鲜输入 + 缓存读取）`。

### 备份

在**设置**中可导出或导入完整的 SQLite 备份，也可使用命令行：

```bash
toksight refresh                  # 采集最新会话
toksight export-db backup.sqlite  # 导出到新文件
toksight import-db backup.sqlite  # 合并到本地历史
```

备份包含全部日期和 Agent 的用量。导入时保留本地记录，相同记录只计一次。需要跨设备备份和恢复时，可配置自己的私有 GitHub 仓库。[GitHub 备份配置](https://github.com/Sanstoolow0513/toksight/blob/release/doc/github-backup.md)

## 隐私

toksight 只读访问 Agent 文件，报告默认保存在本机。`--offline` 可关闭价格下载。备份包含会话标题和目录，分享备份文件时也会分享这些信息。

## JSON 输出

运行 `toksight daily --week --json` 可获取汇总、按 Agent、模型、日期和会话划分的用量，以及定价覆盖情况和采集警告。[JSON 字段说明](https://github.com/Sanstoolow0513/toksight/blob/release/doc/data-contract.md)

## 开发

开发 PR 提交到 `dev`，发布 PR 提交到 `release`。运行 `npm test` 执行离线测试。开发网页时先运行 `npm run web:ci`，再运行 `npm run web:dev`，打开 `http://127.0.0.1:3000`。使用 `npm run check:package` 验证安装包。[项目规范](https://github.com/Sanstoolow0513/toksight/blob/release/AGENTS.md) · [开发与发布指南](https://github.com/Sanstoolow0513/toksight/blob/release/doc/development-release.md)

## 许可

[MIT](./LICENSE)。本项目独立于各 Agent 厂商，灵感来自 [tokscale](https://github.com/junhoyeo/tokscale) 和 [ccusage](https://github.com/ccusage/ccusage)。厂商标志来自 [LobeHub Icons](https://github.com/lobehub/lobe-icons)，详见[附带许可](https://github.com/Sanstoolow0513/toksight/blob/release/frontend/public/logos/LICENSE.txt)。
