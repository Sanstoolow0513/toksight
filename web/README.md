# toksight web dashboard

`toksight web` 的前端：一个 Next.js（App Router）静态导出应用，由 CLI 内置的零依赖
HTTP 服务器（`src/webserver.js`）托管，数据来自同源的 `/api/data` 实时 JSON API。

## 使用

正常使用不需要进入本目录 —— 在仓库根目录：

```bash
npm run web:build   # 首次构建静态资源到 web/out/
node bin/toksight.js web   # 启动本地服务并自动打开浏览器（默认 http://127.0.0.1:4729）
```

未构建时 `toksight web` 会在 `/` 显示构建指引页，`/api/data` 仍可用。

## 开发

```bash
# 终端 1：只启动 JSON API
node bin/toksight.js web --api-only

# 终端 2：Next dev server（自动把 /api/* 代理到上面的 4729 端口）
npm run dev
```

`next.config.mjs` 在 `NODE_ENV=development` 下启用 `/api/*` rewrite（可用
`TOKSIGHT_DEV_API` 覆盖目标地址）；`next build` 则输出纯静态站点（`output: 'export'`）。

## 结构

- `app/page.js` — 仪表盘页面（客户端组件：KPI、热力图、趋势、Agent 分布、小时/月度分布、模型与会话表格）
- `components/` — `Heatmap`（GitHub 风格活动热力图）、`TrendChart`（近 30 天堆叠柱）、`Donut`（Agent 占比）、`Bars`（小时/月度直方图）
- `lib/format.js` — 数字/时间格式化（与 CLI `src/format.js` 口径一致）
- `next.config.mjs` — 静态导出 / dev 代理配置

API 返回 `--json` 载荷外加 web 专属字段（`heatmap`、`trend`、`hourly`、`today`、
`last7Days`、`thisMonth`、`topSessions`、`longestSession`、`activityRange`、`timezone`），
由 `src/webdata.js` 计算，本地时区分组。
