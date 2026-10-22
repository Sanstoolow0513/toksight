# 本机价格库

## 初始化与更新

Web 首次启动离线建立用量快照，`PriceSetup` 引导下载 LiteLLM 价格或使用本地价格继续。
`web_setup` 保存引导完成时间和 `auto_update`；`price_preferences.sources_json` 保存来源选择，不依赖浏览器。
公开来源只有默认启用的 `litellm`；`selectedSources` 仅接受 `['litellm']` 或 `[]`。旧多来源选择迁移到默认值，
明确的空选择仍关闭下载价格。用户 `pricing.json` 不受开关影响。

`POST /api/setup` 接受布尔 `offline` / `autoUpdate` 与可选 `selectedSources`；缺省保持原偏好。
在线保存按选择更新，离线保存仅改变本地查询。首次本地继续推迟第一次自动检查一小时；`--offline` 始终禁止网络更新。
`src/priceselection.js` 将同一筛选用于当前目录、历史、快照和导入回退。关闭来源清除派生估价，保留自报费用。
备份不会覆盖目的库的来源和自动更新偏好。

`GET /api/prices/status` 返回 completed、completedAt、autoUpdate、selectedSources、availableSources、prices、
revisions、observedAt、offline、updating 和 warnings。`GET /api/prices` 返回 records、updates、status、offline、
updating、warnings。价格保留 USD/token 四类单价、上下文元数据及稳定 id、revisions、observedAt。
单个 `key=<id>` 返回该项 history（observedAt / record），从新到旧；未知 key 返回空历史。
未知、重复或空参数返回 400。目录和历史 GET 只读已提交事务，不初始化引导、采集或联网。
页面显示美元/百万 token，并明确标注本机观察时间；用户覆盖没有观察历史。

自动更新使用可清理、unref 的小时定时器，也在启动和报告读取时检查。成功价格七天到期，失败一小时后重试。
手动更新强制检查；并发自动/手动更新共享任务。关闭服务停止定时器，并防止未完成下载写入已关闭数据库。
更新不扫描 Agent 文件，结果在 SQLite 事务中提交。

## 第一方 LiteLLM 目录

`src/pricing.js` 下载 LiteLLM 的 `model_prices_and_context_window.json`，使用七天缓存。
`src/firstparty.js` 检查提供商及模型归属，输出以下统一渠道：

| LiteLLM 提供商 | 计价渠道 | 收录范围 |
| --- | --- | --- |
| openai、anthropic、deepseek、moonshot、zai、xai、minimax、ai21 | 同名 | 该提供商的直接 API 表 |
| gemini | google | Gemini API 表，不混入 Vertex 市场 |
| mistral、codestral | mistral | Mistral 自有模型，排除 GLM 等托管模型 |
| dashscope、qwen_ai_platform | alibaba | 仅 Qwen / QwQ，排除 DeepSeek、GLM、Kimi |
| cohere_chat | cohere | Cohere 直接 API 表 |

LiteLLM 的 Qwen `tiered_pricing` 数组可独立提供价格，不要求顶层重复 input/output 字段。
`normalizeLitellmPrice` 将首段转换为基础价，后续段转换为 contextTiers；范围须从 0 开始、边界为安全整数，
排序后严格连续。使用 LiteLLM 的 `(start, end]` 规则：32,000 token 留在第一档，32,001 进入第二档；
请求的全部新鲜输入、缓存读和缓存写共同选档，整次输入和输出使用同一档价格。超过最终范围沿用最后一档。
每档缺少缓存价时按该档输入价回退；输出可沿用明确的顶层输出价。空表、重叠、缺口或无效费率不推断。
标准 `*_above_N_tokens` 字段仍沿用各自的基础价和缓存回退规则。

同一提供商的不同直接 API 表可能保留不同价格，例如 `codestral/codestral-latest` 与
`mistral/codestral-latest`。这类原始目录 ID 分别保留；裸名存在价格歧义时不自动选择，需使用完整 ID 或用户覆盖。

未知提供商、聚合商、转售商和不匹配的模型前缀不参与估算；source URL 不能代替提供商归属验证。
仅接收 chat / responses 与有效的非负 token 单价。Google 不混合 Vertex 的另一套费率，Qwen 不收录 qwencloud。
不再抓取厂商 HTML/Markdown，不访问 OpenRouter 目录或端点。磁盘中的旧价格不能绕过第一方筛选。
下载失败保留可用缓存和已提交价格，警告通过现有状态和报告返回。

## 历史与重算

price_history 保存 price_key、observed_at、signature、record_json；键区分范围、来源和原始目录名。
LiteLLM 价格、上下文档位或匹配信息变化才新增版本；获取时间变化本身不创建版本。用户覆盖使用当前值。
src/pricehistory.js 按请求时间选择最后一次已观察价格；早于首次观察的记录使用最早已知价格作参考。
本机观察时间不是官方生效时间，不能补全错过的调价。选择历史版本后逐请求应用上下文档位；时区不影响费用。
自报金额保持优先。

快照、当前目录和历史在同一读事务加载，查价器按历史区间缓存。价格更新失效快照缓存后重算估价，
无需写回原始 Agent 用量。SQLite 备份保留符合第一方规则的目录与历史；同键同时间冲突保留目的库版本。
旧官网、聚合商和已移除客户端的价格不作为回退使用。

## 提供商映射

采集器保留 Codex session_meta.model_provider、OpenCode providerID、ZCode rollout providerId。
Kimi 按同一 agent 文件的 agentId/kind/model 关联 llm.request 和 usage.record，不能确认时不推断。
Claude 的 1h 缓存写入子集仍保存为可选 cacheWrite1hTokens，但不从 LiteLLM 标准上下文价推断缓存时长费用。
providerId、pricingProvider、providerEndpoint、cacheWrite1hTokens 均经备份验证，不参与去重身份。

src/providerbindings.js 读取 `<toksight-dir>/providers.json`。每项声明 client、providerId、provider，可选
model、endpoint、since、until。使用原厂参考价的渠道为 openai、anthropic、google、xai、deepseek、moonshot、
alibaba、zai、minimax、mistral、cohere、ai21。时间必须为带时区 ISO 时刻，包含 since、不包含 until。
模型精确绑定优先；同等具体程度的重叠不推断。刷新或价格更新后重算绑定；删除绑定恢复原始 providerId。
未知自定义提供商不自动使用原厂价；pricing.json 的 USD/百万 token 覆盖仍优先。

## 重置价格库

价格页确认后调用 POST /api/prices/reset；CLI reset-prices 支持 JSON 和离线使用，拒绝日期/客户端筛选。
src/pricereset.js 清理 toksight 下载的价格缓存，保留用户配置。database.resetPrices() 在事务内清空
model_prices、price_updates、price_history、web_setup，以及快照和导入的价格回退值。
用量、导入、自报费用、来源选择和快照刷新时间保留；SQLite 文件仍用于存放用量。
数据库失败回滚价格和引导状态；缓存删除先于事务，已删除缓存可在下次下载恢复。

服务重置拒绝本进程执行中的刷新、更新和引导（409），停止自动检查并返回未完成引导状态。
CLI 重置前需关闭其他 toksight 进程，避免旧任务重新写价；其他连接用 data_version 发现已提交重置。
重置本身不联网或采集。新价格建立前旧估价为空，自报费用不变；离线继续重新加载用户覆盖。
