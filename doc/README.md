# toksight 开发知识索引

这里记录当前实现的内部机制与维护约定。面向用户的安装、选项和使用方式以根目录 [README.md](../README.md) / [README.zh-CN.md](../README.zh-CN.md) 为准；视觉和交互验收以 [design-spec.md](../design-spec.md) 为准。实现细节若与本文冲突，以当前代码和测试为准，并同步修正文档。

| 想查什么 | 文档 | 主要代码 |
| --- | --- | --- |
| 模块职责、数据流、命令入口 | [架构](architecture.md) | `src/cli.js`、`src/collect.js`、`src/webservice.js` |
| 新增 Agent、解析器口径、容错与去重 | [采集器](collectors.md) | `src/clients/`、`src/fsutils.js` |
| 标准记录、日期、聚合、CLI JSON 与 Web 数据字段 | [数据契约](data-contract.md) | `src/payload.js`、`src/aggregate.js`、`src/webdata.js` |
| SQLite 快照、导入/导出、Cursor CSV、价格来源 | [存储与定价](storage-pricing.md) | `src/database.js`、`src/dbtransfer.js`、`src/pricing.js` |
| HTTP 路由与安全边界、报告页、单日展开 | [Web 报告](web-report.md) | `src/webserver.js`、`web/` |
| 本地验证、打包和发布 | [开发与发布](development-release.md) | `package.json`、`scripts/`、`.github/workflows/` |

这些文档按主题检索，不按开发时间排列。新增事实应更新对应主题；根 [AGENTS.md](../AGENTS.md) 只保留工作边界和入口。
