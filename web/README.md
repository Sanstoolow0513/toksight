# toksight web dashboard

`toksight web` 的前端：一个 Next.js（App Router）静态导出应用，由 CLI 内置的零依赖
HTTP 服务器（`src/webserver.js`）托管，数据来自同源的 `/api/data` 实时 JSON API。

页面是一份按月 / 按年的 token 用量与成本报告：点阵背景 + Claude 明暗配色，三张可拖动排序的
章节卡片（热力图 · Agent · 模型），可整页导出 PNG。视觉与交互规范见仓库根目录
`design-spec.md`（v7），实现以 spec 为准。

## 使用

安装包用户直接运行 `toksight web`，无需构建或安装 Next。
点击报告左侧的“导入 Cursor CSV”小卡片，选择 Cursor 导出的 Usage Events 文件，即可把历史用量加入报告。
导入通过本机 API 写入 toksight 自己的 SQLite；重复导入会去重，普通刷新不会清除导入数据。
从源码预览发布版页面时，在仓库根目录运行（Node >=22.5）：

```bash
npm run web:ci      # 按 lockfile 安装构建依赖，首次需要网络
npm run web:build   # 只构建静态资源到 web/out/，不安装依赖
node bin/toksight.js web   # 启动本地服务并打印地址（默认 http://127.0.0.1:4729；--open 才打开浏览器）
```

未构建时 `toksight web` 会在 `/` 显示构建指引页，`/api/data` 仍可用。
构建后刷新页面即可；修改源码后需重新构建，或使用下面的开发模式。

## 开发

```bash
# 仓库根目录，一个命令启动 API + Next dev
npm run web:dev
# 自定义端口，关闭开发 API 的价格拉取
npm run web:dev -- --port 3001 --api-port 4730 --offline
```

打开 `http://127.0.0.1:3000`，前端代理 API `http://127.0.0.1:4729`。
不需要预先构建；Ctrl+C 会关闭两个服务，端口冲突会报错并清理已经启动的服务。

需要分开管理时，在仓库根目录的两个终端分别运行：

```bash
node bin/toksight.js web --api-only
npm run web:dev:ui
```

单独启动前端时可用 `TOKSIGHT_DEV_API` 覆盖代理目标；在本目录运行 `npm run dev` 也只启动前端。
`next.config.mjs` 依据 Next 的开发阶段启用 `/api/*` rewrite；生产构建始终是
`output: 'export'`，不会受残留的 `TOKSIGHT_DEV_API` 影响。生产页面由 CLI 提供，不使用 `next start`。

## 交付验证

在仓库根目录运行 `npm run check:package`：自动安装锁定依赖、构建并打包，再离线安装到临时
目录，使用临时 Agent 数据启动包内 CLI，验证页面、静态资源与数据 API（含按月查询、`scopeRange`
和 Cursor CSV 导入）。检查完成后
清理临时安装。PR、main 分支与 Release 工作流会在 Ubuntu/Windows 上执行这个检查。

## 结构

- `app/layout.js` — 字体（Geist Sans/Mono、自托管 Source Serif 4）与首帧前写入 `data-theme` 的内联脚本
- `app/page.js` — 报告页：顶栏 → 左侧操作卡片 + `.report`（KPI、三张卡片、页脚）；`.report` 就是导出图片的范围
- `app/globals.css` — 明暗两套 CSS 变量、点阵背景与全部组件样式
- `components/Toolbar.jsx` — 月/年、周期翻页、配色、语言、刷新
- `components/ReportActions.jsx` — 报告左侧的 CSV 导入、图片导出、单价更新小卡片；窄屏排在报告上方
- `components/SortableCards.jsx` — 手柄拖动排序（Pointer Events、边缘自动滚动、FLIP 归位、↑/↓ 键）
- `components/HeatmapCard.jsx` / `AgentsCard.jsx` / `ModelsCard.jsx` — 三个章节；`Card`、`RankList`、`Segmented`、`Tooltip`、`BrandMark` 为共享件
- `lib/period.js` — 本地日期的月/年边界、翻页与周一开头的日历周
- `lib/report.js` — 纯聚合：热力图统计、按 Agent 分开的模型排行、构成分段、“其他 N 项模型用量”
- `lib/useReport.js` — 按周期请求 `/api/data`，取消过期请求、加载时保留旧数据
- `lib/exportImage.js` — 用 `modern-screenshot` 把 `.report` 导出为 PNG（去掉 `.no-export`）
- `lib/prefs.js` — 所有 `localStorage` 偏好（语言、配色、周期模式、卡片顺序与指标）
- `lib/format.js` / `lib/i18n.js` — 数字格式化与中英文案
- `next.config.mjs` — 静态导出 / dev 代理配置

`lib/period.js`、`lib/report.js`、`lib/i18n.js` 不依赖 React，由根目录 `test/webreport.test.js` 与
`test/i18n.test.js` 覆盖。

页面每次只请求一个日历周期：`GET /api/data?period=custom&since=2026-09-01&until=2026-09-30`，
热力图取 `daily`、Agent 取 `clients`、模型取 `models`（每行一个 Agent 与统一模型名），翻页边界取
`scopeRange`。这些字段由 `src/payload.js` / `src/webservice.js` 计算，按本机时区分组，日期与
启动范围取交集。
