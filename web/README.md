# toksight web dashboard

`toksight web` 的前端：一个 Next.js（App Router）静态导出应用，由 CLI 内置的零依赖
HTTP 服务器（`src/webserver.js`）托管，数据来自同源的 `/api/data` 实时 JSON API。

视觉规范见仓库根目录 `design-spec.md`（v6 Brutalism 磷光工作表），实现以 spec 为准。

## 使用

安装包用户直接运行 `toksight web`，无需构建或安装 Next。
从源码预览发布版页面时，在仓库根目录运行（Node >=20.9，建议 22 或 24）：

```bash
npm run web:ci      # 按 lockfile 安装构建依赖，首次需要网络
npm run web:build   # 只构建静态资源到 web/out/，不安装依赖
node bin/toksight.js web   # 启动本地服务并自动打开浏览器（默认 http://127.0.0.1:4729）
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
目录，使用临时 Agent 数据启动包内 CLI，验证首页、配置页、静态资源、API 与导入/恢复往返流程（只操作临时配置）。检查完成后
清理临时安装。PR、main 分支与 Release 工作流会在 Ubuntu/Windows 上执行这个检查。

## 结构

- `app/page.js` — 仪表盘页面（客户端组件：KPI 条、12 列工作表、热力图、趋势、Agent 分布、小时/月/节奏、模型与会话表格；中英切换）
- `app/config/page.js` — 配置摘要与文件预览
- `components/` — 图表、共享 `Tip`、配置迁移入口 `TransferPanel`
- `components/config/` — `AgentCard` / `FileCard`、`ExportPanel`、`ImportPanel`、`ImportPlan`、`ImportResults`、`RestorePanel`
- `lib/config.js` / `lib/transfer.js` — 配置标签、格式化、选择规则与 bundle 解析
- `lib/format.js` — 数字/时间格式化（与 CLI `src/format.js` 口径一致）
- `lib/i18n.js` — 界面文案（`zh-CN` / `en`）
- `lib/palette.js` — 分类色（与 `design-spec.md` / `globals.css` 的 `--color-cat-*` 对齐）
- `next.config.mjs` — 静态导出 / dev 代理配置
- `DashboardFilters` / `CostDetails` / `PeriodComparison` — 网页筛选、参考费用来源与相邻日历周期比较
- `lib/useDashboardData.js` — URL 筛选状态、请求取消与过期响应隔离

API 返回 `--json` 载荷外加 web 专属字段（`heatmap`、`trend`、`hourly`、`today`、
`last7Days`、`last30Days`、`thisMonth`、`topSessions`、`longestSession`、`streaks`、
`peakDay`、`activityRange`、`timezone`），由 `src/webdata.js` 计算，本地时区分组。
`src/webservice.js` 在同一次采集结果上独立处理各请求的筛选；`view`、`selection`、
`costCoverage`、`comparison` 是新增字段，原有 `--json` 契约保持不变。日期筛选与启动范围
取交集，图表最多展示所选时段的最后 366 天，完整汇总与比较不截断。
