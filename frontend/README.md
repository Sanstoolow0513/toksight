# toksight frontend

本地用量工作台，采用“刻度账本”设计语言（见 [视觉规范](../design-spec.md)）。使用 Next App Router、React、Geist、Instrument Serif、Lucide 和原生 CSS（`@layer`），静态导出后由 toksight CLI 提供页面与同源 API。

在仓库根目录运行：

```sh
npm run frontend:ci
npm run frontend:dev
```

开发页面为 `http://127.0.0.1:3000`，API 为 `http://127.0.0.1:4729`。可用 `-- --port 3001 --api-port 4730 --offline` 覆盖。`frontend:dev:ui` 单独启动 Next；`TOKSIGHT_DEV_API` 只影响开发代理。

```sh
npm test
npm run frontend:build
node bin/toksight.js web
npm run check:package
```

`frontend:build` 导出到 `frontend/out/`。根包零运行时依赖，网页依赖仅在本目录。`web:*` 命令为兼容入口，也使用本目录；旧 `web/` 已移除。

- `components/Workspace.jsx`：顶部工具栏（含 `PageActions` 页面操作）、侧栏与四个页面。
- `lib/useWorkspace.js`：筛选、时区、刷新、价格状态和导入 / 导出流程。
- `components/ActivityChart.jsx`、`TokenBreakdown.jsx`：本地小时用量与 Token 构成。
- `components/CalendarView.jsx`：日历、日期详情与趋势。
- `lib/period.js`、`report.js`：沿用已有测试覆盖的日期与聚合算法。
- `app/globals.css`：声明 `@layer` 顺序并引入 `app/styles/`：`tokens`（明暗色、字号、间距、圆角、线条、动效）、`base`、`primitives`、`shell`、`report`、`calendar`、`manage`、`utilities`。
- `components/ui/`：共享原语 Button / IconButton、Segmented、Panel、Stat、Meter、Badge、Field、Tooltip + `useTip`；页面组件只组合原语。
- `app/fonts/`：随包提供的 Instrument Serif（SIL OFL，许可见同目录），经 `next/font/local` 打包，无远程字体请求。

详情见 [Web 报告](../doc/web-report.md)、[架构](../doc/architecture.md)、[视觉规范](../design-spec.md)。
