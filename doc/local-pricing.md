# 本机价格库

## 初始化与更新

Web 首次启动离线建立用量快照，主内容区的 `PriceSetup` 引导获取公开价格或使用本地价格继续。
`web_setup` 保存引导完成时间、`auto_update` 偏好，不依赖浏览器。`POST /api/setup` 只接受布尔
`offline` / `autoUpdate`，本地继续会推迟第一次自动检查一小时；`--offline` 始终禁止网络更新。
`GET /api/prices/status` 返回 completed、completedAt、autoUpdate、prices、revisions、observedAt、offline、updating、warnings。

服务开启自动更新后，用可清理、unref 的小时定时器检查价格，也保留启动/报告读取检查。
成功价格七天到期，失败一小时后重试。手动更新强制检查；并发自动/手动更新共享一个任务，关闭
服务停止定时器并防止未完成下载写入已关闭数据库。更新不扫描 Agent 文件，结果在 SQLite 事务中提交。

## 本地来源

`src/publicpricing.js` 直接访问 OpenAI、Anthropic、Google 官方价格页和 OpenRouter `/api/v1/models`。
OpenAI 的折叠模型行从限定组件的序列化表格数据解码，不运行页面脚本。其他页面从可见 Standard
价格表读取。Cursor 继续使用现有官方目录抓取器。Web 不联网刷新 LiteLLM；已有缓存/内置价只作回退。
CLI 尚无本地公开历史时保留旧来源，建立历史后优先使用本地目录，不联网更新 LiteLLM/Cursor。

OpenRouter 只为使用过的路由模型获取端点详情，最多四个并发、最多一百个模型，保留默认模型报价
和端点单价。价格不能跨渠道套用；未知供应端点的模型报价是参考估算，明确端点缺失时不回退猜测。
支持折扣及明确的上下文/UTC 时间窗口、星期条件，按各价格键依序应用匹配规则。
OpenAI 未明确阈值的长上下文报价保留基础价参考；Google 明确日期促销按本次获取时刻取价，后续
变化在下次更新时观察。Google 文本估算不包含音频、缓存存储及工具费用。
Anthropic 的 1h 缓存写入价格在 Claude 日志明确给出 1h token 数时使用，否则按默认缓存写入参考。

单个来源下载/解析失败保留已提交价格，不影响其他来源。格式或价格单位无法可靠解析时跳过；
新下载目录缺少旧原名时保留该原名并标记 retained，不能靠一次页面变化删除已知价格。

## 历史与重算

`price_history` 保存 price_key、observed_at、signature、record_json。键区分计价范围、来源、原始
目录名/端点和 Cursor 上下文档位。仅价格、条件或匹配信息改变才新增版本；刷新时间和 retained
标志不创建版本。历史机制用于直接获取的公开价格与 Cursor，旧 LiteLLM 回退和用户覆盖仍按当前值计算。

`src/pricehistory.js` 按请求时间选择最后一次已观察价格；早于首次观察的记录使用最早已知价格
作为参考。本机观察时间不是官方生效时间，不能补全未更新期间错过的调价。选定历史版本后再逐
请求应用上下文与 UTC 时间条件；改变报告时区不会改变费用。自报金额保持优先。

快照、当前价格和历史在同一读事务加载，查价器按历史时间区间缓存。价格更新失效快照缓存后
重新计算估算，旧请求保留旧费率，新请求获得适用费率。无需写回每条原始 Agent 用量。
SQLite 备份包含价格历史；导入先验证签名、时间和价格元数据，冲突的同键同时间记录保留目的库
版本。首次引导/自动更新偏好不从备份覆盖目的库。

## 提供商映射

采集器保留 Codex session_meta.model_provider、OpenCode providerID、ZCode rollout providerId。
Kimi 同一 agent 文件中按 agentId/kind/model 关联 llm.request 和 usage.record，不能确认时不推断。
Claude 日志的缓存 1h token 数保存为 cacheWrite1hTokens（cacheWriteTokens 的子集）。这些字段可选，
不改变原有 token/JSON 语义；新增 providerId、pricingProvider、providerEndpoint、cacheWrite1hTokens
均经备份导入验证，不参与用量去重身份。

`src/providerbindings.js` 读取 `<toksight-dir>/providers.json` 数组。每项声明 client、providerId、provider
（openai/anthropic/google/openrouter），可选 endpoint、model、since、until。时间为带时区的准确
ISO 时刻，区间包含 since、不包含 until。模型精确绑定优先；同等具体程度的重叠不猜测。
派生绑定在刷新或价格更新后重算，删除绑定会恢复原始 providerId。`pricing.json` 仍为最高优先级
的 USD/百万 token 覆盖。未知自定义提供商不自动使用原生厂商价，不读取今天的 Agent 配置倒推历史。
