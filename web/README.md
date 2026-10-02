# toksight web dashboard

`toksight web` 的前端：一个 Next.js（App Router）静态导出应用，由 CLI 内置的零依赖
HTTP 服务器（`src/webserver.js`）托管，数据来自同源的 `/api/data` JSON API；普通查询读取已提交快照。

默认打开今天，采用全高侧栏与主内容左右分区；Logo 靠侧栏顶部，今天 / 日历 / 设置导航组垂直居中，
配色与语言切换位于底部。侧栏为无点阵灰底，主内容保留减弱的点阵；窄屏通过“显示偏好”菜单切换配色与语言。
今天突出 Tokens / 费用，直接展示小时分布、Agent / 模型与会话；单模型信息不重复生成模型排行。
日历先展示范围总量，窄屏选择日期后定位单日详情，趋势位于详情之后并提供快捷入口。
设置提供可调整时区、数据库导入导出和 Cursor CSV。刷新、图片导出与更新单价在内容顶部。
视觉与交互规范见仓库根目录 `design-spec.md`。

## 使用

安装包用户直接运行 `toksight web`，无需构建或安装 Next。
点击设置中的“导入 Cursor CSV”，选择 Cursor 导出的 Usage Events 文件，即可把历史用量加入报告。
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

- `app/page.js`：应用状态、操作与请求协调，默认 Today；`.report` 是图片捕获区域。
- `app/layout.js`：本地字体、首帧主题脚本；`app/globals.css`：两套配色、应用框架、点阵、响应式样式。
- `components/Sidebar.jsx`：顶部品牌、居中导航、底部配色与语言切换，以及当前时区入口。
- `components/ReportActions.jsx`：刷新、单价更新、PNG 导出；`ReportFooter.jsx`：时间、时区和价格说明。
- `components/Settings.jsx` / `DatabaseImport.jsx`：时区、数据管理、数据库合并确认。
- `components/CalendarView.jsx` / `HeatGrid.jsx`：顶部范围统计、月 / 年日历、选择定位和内联单日详情。
- `components/ReportFilters.jsx`：Agent、快捷范围、月份、自定义日期与重置。
- `components/DayDetail.jsx`：单日头和直接展开的 `DayBody`，Today 复用同样内容。
- `components/TrendCard.jsx`：所选范围的 tokens / 费用趋势，平铺显示。
- `components/AgentTable.jsx` / `ModelTable.jsx`：可展开 Agent 与跨 Agent 模型表、排序、行内明细和悬停提示；窄表仍可点击或键盘查看完整数据。
- `components/Kpis.jsx` / `Marks.jsx`：四项 KPI、构成条、身份色、缓存命中环与费用标记。
- `lib/period.js`：浏览器时区检测、IANA 校验、日期标签、范围与日历运算。
- `lib/useReport.js`：独立范围 / 单日请求，将日期、Agent、时区纳入取消和过期响应校验。
- `lib/useTableColumns.js`：观察表格实际显示的表头，保证行内明细跨列不会挤压窄表。
- `lib/report.js`：纯聚合、排序、模型分组、小时柱与趋势序列。
- `lib/prefs.js`：localStorage 语言、主题、时区、日历模式和表格排序；旧卡片顺序不再读取。
- `lib/format.js` / `lib/i18n.js`：数值与所选时区时间格式、中英文案。
- `lib/exportImage.js`：捕获报告为 PNG，过滤 `.no-export`。
- `next.config.mjs`：静态导出 / 开发代理配置。

日期与纯计算由根目录 `test/webreport.test.js`、`test/dates.test.js`、`test/webservice.test.js` 覆盖；
中英文案键一致性由 `test/i18n.test.js` 覆盖。

范围与单日都请求 `GET /api/data?period=custom&since=…&until=…&timezone=Asia%2FShanghai`，
Agent 筛选附加 `client`。服务端在所选时区分组与计算边界，仍与启动范围取交集，CLI 继续使用系统本地时区。
