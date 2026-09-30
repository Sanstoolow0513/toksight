# 存储、导入与定价

## 已提交快照

`src/database.js` 维护 toksight 自己的 SQLite：`snapshot_meta`、`entries`、`usage_imports`、`cursor_imports`、`model_prices`、`price_updates`。Web 启动先预载已提交快照；没有快照才扫描 Agent。`GET /api/data` 只筛选快照。CLI `refresh` 和 `POST /api/refresh` 全量重扫并在事务内替换；失败不替换旧数据，并发刷新共享同一采集/写入任务。SQLite `data_version` 用于发现其他进程的提交。

普通 CLI 报告仍调用 `collectAll` 读取当前 Agent 文件，并将 `usage_imports` 中的持久记录合并进结果。Cursor 的 CLI 采集器只读 toksight 数据库。刷新保留持久导入；Cursor CSV 导入可以让已提交报告立即更新而不重扫其他客户端。

## 数据库备份

CLI `export-db <file>` / `import-db <file>` 与 Web `GET /api/export/db` / `POST /api/import/db` 对应。导出用 `VACUUM INTO` 生成含已提交 WAL 数据的独立 SQLite，包含记录、导入和价格。导入上限 256 MB，先完整验证文件头、schema、版本、完整性、行字段与身份，再原子合并；错误文件不应改变目标库。

非 Cursor 导入保存在 `usage_imports`。去重身份由客户端、会话、时间、模型和五类 token 数组成，不含费用、标题或目录；occurrence 序号保留完全相同的多次请求，同时避免重叠备份双算。已存在的自报费用优先，导入自报费用可填补估价。备份里的价格补齐目的库缺失记录，离线目的库还能按模型使用导入价格。身份和合并逻辑在 `src/usageimports.js`。

## Cursor Usage Events

`POST /api/import/cursor` 接受原始 UTF-8 CSV；`src/cursorcsv.js` 校验列，接受 BOM、CRLF、带引号的逗号/换行，跳过零用量行。`Input (w/o Cache Write)` 是新鲜输入，`Input (w/ Cache Write)` 是缓存写入，`Cache Read` 是缓存读取。CSV 不提供 session ID。

Cursor 没有事件 ID，导入身份以时间、模型和四类 token 数为基础，occurrence 区分同值重复行；费用和其他可变列不进入身份。重叠导出或改价重导不会双算，后来出现的数值费用可更新之前的 `Included`。读路径按新身份折叠旧版本的全列 fingerprint，保留原始存储行。若 Cursor 后来修改时间、模型或 token 数，现有数据无法可靠判断是否同一事件。

`Max Mode` 列保存为可选 `entry.cursorMaxMode`（布尔或 null），旧记录可缺失。CSV 重导可更正已知模式而保留已有数字费用，空白/未知模式不抹去已知值；备份合并只补齐缺失模式。读取旧 fingerprint 变体时，费用与模式元数据分别择取，避免带费用的旧行遮住新导入的模式信息。

## 价格目录与费用归属

- 非 Cursor 来源：内置估价 → LiteLLM 公共价格（7 天磁盘缓存）→ 用户 `pricing.json` 覆盖。覆盖可用模型精确名或无歧义的 `provider/` 后缀。四种 USD/token 价格是 input、output、cache read、cache write；缺少缓存价格时退回 input 单价并在费用覆盖信息中标记。
- Cursor 的 `Included` 没有实收金额。`src/cursorpricing.js` 抓官方 Markdown 总表及 `docs/llms.txt`；`src/cursorpricepages.js` 从索引发现同站 `/docs/models/` 详情页，以最多四个并发请求解析 HTML 中的 Model ID 和价格表，不执行页面脚本，不依赖 CSS 类名。总表与详情按模型词项及上下文档位合并，详情补全 Fast 等价格。缓存版本 2 仍保留七天 TTL，在线读取版本 1 会升级；详情失败使用总表及缓存并报警，缺失的旧条目保留原抓取时间并标记 `retained`。CSV 数字费用或 `Free` 始终优先；历史估价不代表历史账单。
- `src/cursormodels.js` 用下载目录匹配 Cursor 模型，不含模型家族白名单、版本列表或 Max 型号例外。统一标点、版本写法、数字粘连及词序后，优先匹配最长完整名称/官方别名；其次接受无歧义的省略首词简写，只允许多出的通用模式词 low/medium/high/xhigh/thinking/max。官方名称本身的 Max 会优先匹配，因此无需型号特判；未知后缀或歧义不猜价格。Cursor 展示名使用目录名称，未匹配时保留原名。其他 Agent 的匹配和显示规则保持独立。
- `model_prices.metadata_json` 保存可选 Cursor 元数据（aliases、contextOver、url、fetchedAt、retained），旧库自动补列；备份和 CLI 只读路径兼容无该列的旧库。`priceFor(model, client, entry)` 可按请求的新鲜输入 + cache read + cache write 选择表中明确标注 `Long Context (>N)` 的档位，不从任意备注猜倍率。没有请求信息时返回基础档位，用于模型归并。同一原始 ID 跨多个实际单价时，JSON 标记 variableRates 并省略单一单价，避免悬停提示误导。缺少路由信息的 Auto、未公开价格、无法识别的计费条件仍不自动推断；没有套餐信息时不加旧套餐 Max 附加费。
- `src/pricecatalog.js` 按 `scope` 隔离 Cursor 与其他来源；`price_updates` 存拉取状态，`src/costcoverage.js` 单独披露自报金额、Cursor 参考估算和其他估算的来源。普通 CLI 有 Cursor 记录时也加载目录，以便自报费用的记录使用同一套展示归并。

Web 启动和报告读取会检查两种公开价格是否到期；手动 `POST /api/prices/update` 强制检查两者。`--offline` 禁止网络价格请求，但可使用已有缓存；离线 Web 会话不能手动强制更新。价格更新不扫描 Agent 文件。定价逻辑入口是 `src/pricing.js`、`src/cursorpricing.js`、`src/pricecatalog.js`。
