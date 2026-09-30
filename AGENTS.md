# AGENTS.md

## 项目与入口

`toksight` 是 Node >=22.5 的 ESM CLI，读取本机 AI 编码 Agent 用量，统计 token、费用与缓存命中率，并提供本地静态 Web 报告。根包零运行时依赖；刷新和导入更新 toksight 自己的 SQLite，价格抓取更新自己的缓存，绝不修改 Agent 文件。没有 TUI。

开发知识从 [doc/README.md](doc/README.md) 按主题查：

- [架构与模块](doc/architecture.md) · [采集器](doc/collectors.md) · [数据契约](doc/data-contract.md)
- [存储与定价](doc/storage-pricing.md) · [Web 报告](doc/web-report.md) · [开发与发布](doc/development-release.md)

用户用法以 `README.md` / `README.zh-CN.md` 为准；Web 视觉与交互以 `design-spec.md` 为准。修改一个主题时同步更新对应文档，避免在规则文件复制完整机制。

## 常用命令

- `npm test`：无网络 node:test 套件；不要在 Node v24/Windows 上将 `test/` 作为目录参数传给 `node --test`。
- `node bin/toksight.js`：从源码运行 CLI，读取真实本机数据。
- `npm run web:ci` 后 `npm run web:build`：安装锁定的前端依赖并构建 `web/out/`；未构建时 Web 首页显示指引页，API 仍可用。
- `npm run web:dev`：一起启动 API 4729 与 Next 3000；`npm run check:package`：验证安装包、页面、API 和刷新。

## 修改边界

- CLI 入口 `src/cli.js` 只负责分派；采集集中在 `src/collect.js`，JSON 契约集中在 `src/payload.js`，渲染集中在 `src/render.js`。不得改变已有 `--json` 字段语义；Web API 只能加字段。具体结构见[架构](doc/architecture.md)和[数据契约](doc/data-contract.md)。
- 每个采集器接受注入的 `{ env, home }`，坏数据不应让采集失败；新客户端需注册 `clients`/`clientAliases`、补 fixture 与测试、更新双语 README。去重与来源优先级见[采集器](doc/collectors.md)。
- 服务端本地日期算法放在 `src/dates.js`，前端日历算法放在 `web/lib/period.js`；按当地日历天运算，不能盲加 `24h` 或用 UTC ISO 字符串生成本地日期键。
- 新鲜输入不含 cache read；缓存命中率分母不含 cache write。可信自报费用优先，Cursor `Included` 的官方价格只是参考估算。详见[数据契约](doc/data-contract.md)和[存储与定价](doc/storage-pricing.md)。
- Web GET 读取已提交快照，刷新事务替换；新增 API 要遵守回环 Host 和写请求 Origin 检查。不要添加 Agent 配置写路由。详见[Web 报告](doc/web-report.md)。
- 根包不加运行时依赖；Web 依赖只放 `web/package.json`。保持 Windows 兼容，按改动范围运行 `npm test`、`npm run web:build`、`npm run check:package`。
- CLI 选项、数据来源、定价、Web 或 JSON 变化要同步 `README.md` 和 `README.zh-CN.md`。保留 Next 生成的 `web/AGENTS.md` 规则块；发布流程见[开发与发布](doc/development-release.md)。
