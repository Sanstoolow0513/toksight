# 开发、验证与发布

## 本地命令

在仓库根目录使用 Node >=22.5：

| 命令 | 用途 |
| --- | --- |
| `npm test` / `node --test` | 无网络的 node:test 套件；不要在 Node v24/Windows 上把 `test/` 当目录参数传给 `node --test` |
| `npm run smoke` / `node bin/toksight.js` | 用真实本机来源运行源码 CLI |
| `npm run web:ci` | 按 `web/package-lock.json` 安装网页构建依赖，首次需要网络 |
| `npm run web:build` | 构建并检查静态导出 `web/out/`，不负责安装依赖 |
| `npm run web:dev` | 同时启动 API 4729 和 Next 3000；`-- --port <ui> --api-port <api> --offline` 可覆盖，Ctrl+C 关闭两者 |
| `npm run web:dev:ui` | 只运行 Next；与 `node bin/toksight.js web --api-only` 配合，`TOKSIGHT_DEV_API` 可改开发代理目标 |
| `npm run check:package` | 打包、临时离线安装并用 fixture 验证页面、静态资源、API 和数据库刷新 |

Next 生产构建始终静态导出，不受 `TOKSIGHT_DEV_API` 影响。源码运行 `toksight web` 前需要构建 `web/out/`，否则 `/` 显示指引页。根包不添加运行时依赖；依赖只放在 `web/package.json`。项目使用 JavaScript ESM，没有独立 linter 或 typechecker。

## 修改时的检查

| 修改范围 | 检查 |
| --- | --- |
| 解析器或标准记录 | 更新对应 fixture、`test/clients.test.js`、[采集器](collectors.md)和双语 README 的支持表；运行 `npm test` |
| 日期、聚合、JSON | 保持 CLI JSON 原字段；核对本地时区、DST 与过滤；运行对应 node:test 套件 |
| SQLite / 导入 / HTTP | 核对事务回滚、重复导入、Host/Origin、跨进程读取；运行 `npm test` 与安装包检查 |
| Web 布局或交互 | 对照 `design-spec.md`，运行 `npm run web:build`；用户可见改动同步两份 README |
| CLI 选项、来源、价格或 JSON 形状 | 同步 `README.md` 与 `README.zh-CN.md`，保持两份文档结构大体一致 |

`npm run check:package` 会先准备网页构建依赖，再打包到临时目录，用 fixture 检查安装包的页面、资源、`/api/data` 查询范围/周期、Cursor 导入和 SQLite 刷新。`scripts/` 不进入 npm 包。Windows 路径和 `C:\\...` fixture 是测试范围的一部分。

## 分支与推送

| 分支 | 职责 | 推送后的检查 |
| --- | --- | --- |
| `dev` | 日常开发，开发 PR 的目标分支 | `.github/workflows/ci.yml` 运行测试与安装包检查 |
| `release` | 仓库默认分支，接收发布和维护 PR | `.github/workflows/release.yml` 重跑检查，再按版本决定是否发布 |

日常在 `dev` 开发，用 `git push origin dev` 推送；PR 均运行 CI，以 `release` 为目标的 PR 额外校验版本。GitHub 默认分支不会改写本地分支的 upstream，也不会自动同步分支。合入 `release` 后，将 `origin/release` 合回 `dev` 并推送，同步版本和维护改动。

## 发布

从当前 `release` 分支准备包含待发布代码的 PR，运行 `npm run release:version -- 1.1.0` 同步更新根 `package.json`、`web/package.json` 及两个 lockfile。PR CI 校验版本、Ubuntu/Windows 的 Node 22/24 测试和两平台的安装包检查；通过后合并到 `release`。

`.github/workflows/release.yml` 由 `release` 分支的推送触发，重跑检查后创建同版本标签，通过 npm Trusted Publishing 发布，再创建 GitHub Release。版本不变的维护 PR 不发布。`prepublishOnly` 重跑测试；`prepack` 安装锁定的网页依赖并重建 `web/out/`。配置、恢复和线上验收以[发布指南](release.md)为准。
