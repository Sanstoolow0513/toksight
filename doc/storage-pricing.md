# 存储、导入与定价

首次建库、第一方 LiteLLM 筛选、更新、历史和提供商绑定见[本机价格库](local-pricing.md)。

## 已提交快照

src/database.js 维护 toksight 的 SQLite：snapshot_meta、entries、usage_imports、model_prices、price_updates，
以及价格历史与偏好表。Web 启动预载已提交快照；没有快照才扫描 Agent。GET /api/data 只筛选快照。
CLI refresh 和 POST /api/refresh 全量重扫并事务替换；失败保留旧数据，并发刷新共享采集/写入任务。
SQLite data_version 发现其他进程提交。普通 CLI 仍由 collectAll 读取当前文件，并合并 usage_imports。

价格页和 CLI reset-prices 清除价格、历史、缓存及存储回退，保留用量和导入，随后重新引导建库。
打开数据库时删除 model_prices 中来源不是 litellm 或 user 的旧行；这些行已不参与计价和展示。
具体事务与并发边界见[重置价格库](local-pricing.md#重置价格库)。

## 数据库备份

设置页的 GitHub 备份复用同一导出与合并路径，细节见[GitHub 备份](github-backup.md)。

CLI export-db / import-db 对应 Web GET /api/export/db / POST /api/import/db。
导出用 VACUUM INTO 生成含已提交 WAL 数据的独立 SQLite。导入上限 256 MB；先验证文件头、schema、版本、
完整性、行字段与身份，再原子合并；错误文件不改变目标库。

导入记录保存在 usage_imports。身份包含客户端、会话、时间、模型和五类 token 数，不包含费用、标题或目录。
occurrence 序号保留相同请求的多次出现，防止重叠备份双算。已有自报费用优先，导入自报金额可填补估价。
备份价格补齐目的库缺失项，离线也可使用；目的库的偏好不被覆盖。

价格按原始目录名称（忽略大小写和首尾空白）区分，不按去日期的 modelId 合并，避免不同快照版本丢价。
上下文档位保存在目录和逐模型回退中，CLI、Web、重开数据库及离线导入共用逐请求选档。
当前读取和备份合并只接受受支持客户端、用户覆盖及符合第一方规则的 LiteLLM 价格。
旧数据库中已移除客户端的原始存储保留，但不参与报告；旧备份相应记录跳过。

## 价格目录与费用归属

- 可信自报金额优先；其余先用用户 pricing.json，再使用本机保存的第一方 LiteLLM 价。没有可靠价格时保留 token，费用为 null。
- src/firstparty.js 同时校验提供商和模型归属，防止旧缓存、历史或备份恢复转售价格。来源统一为 litellm，provider 表示原厂渠道。
- src/pricecatalog.js 将原始计价键与展示 modelId 分离。同来源先精确原名，再尝试提供商前缀/唯一后缀和日期别名；不剥离 ft: 等计费前缀。同模型、同提供商的日期别名仅在完整费率一致时合并。
- Kimi Code 的 kimi-code/k3、kimi-code/k3-256k 使用 moonshot/kimi-k3 参考别名，保留原始用量 ID。精确端点和用户覆盖优先，不使用第三方 K3 报价；滚动端点不推断历史底层模型。
- 四类 USD/token 费率为 input、output、cacheRead、cacheWrite。缓存价缺失退回输入价，costCoverage 披露受影响请求。缓存读取不计入新鲜输入，缓存写入不进入命中率分母。
- src/contextpricing.js 解析标准 `*_above_N_tokens` / `*_above_Nk_tokens` 字段及 `tiered_pricing` 连续范围表，以单次 input + cacheRead + cacheWrite 选择最高阈值；输出和会话累计量不参与。xAI 阈值包含边界。档位缺少输出/缓存价沿用已公布基础价；基础缓存价也缺失时使用档位输入价。不推断缓存时长、Priority、Flex、Batch 条件。
- model_prices.metadata_json 保存 contextTiers 与 maxInputTokens / maxTokens 等可选元数据，encodePriceMetadata / decodePriceRecord 统一编码和校验。上下文上限只作展示，priceSignature 不包含它们，因此只改上限不会产生价格历史修订。备份验证非负费率、阈值和回退标志；旧库无元数据时使用基础价。
- usedPriceIds 返回价格 id 到日志原始模型名集合的映射，pricegroups 据此为 GET /api/prices 的合并模型行生成 usedAs。
- 同一原始 ID 跨多个实际费率时，pricing.modelRates 标记 variableRates、source 为 null 并省略单一单价。每条请求仍按其适用历史版本和档位算费。costCoverage 区分 reported、user、litellm 和 unknown。

完成引导且开启自动更新后，Web 按小时、启动及报告读取检查 LiteLLM 是否到期；手动更新强制检查。
--offline 禁止网络请求，允许使用有效缓存、历史和用户覆盖。价格更新不扫描 Agent 文件。
