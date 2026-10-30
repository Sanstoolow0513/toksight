# GitHub 备份与恢复

可选功能：在 Web 设置页手动把完整用量数据库快照备份到用户自己的**私有** GitHub 仓库，需要时下载并合并回本机。面向单用户、单机的手动操作：没有设备 ID、多设备冲突处理或自动同步；CLI 暂不提供对应命令。

## 模块与数据流

- `src/ghsync.js`：GitHub CLI 令牌检测（`createGhProbe` / `createGhRunner`）、零依赖 GitHub REST 客户端（内置 `fetch`，可注入 `fetchImpl` / `apiBase` 供测试），以及 `createGitHubBackup({ env, home, database, fetchImpl, now, offline })` 返回的 `status` / `configure` / `upload` / `restore`。
- `src/webservice.js` 暴露 `getData.syncStatus|syncConfig|syncUpload|syncRestore`；上传前确保已有快照，恢复先等待进行中的刷新（与导入一致）。测试可通过 `syncFetch` / `syncApiBase` 注入假 GitHub。
- 前端：`components/GitHubBackup.jsx`（设置页面板与恢复确认 `GitHubRestore` 对话框）、`lib/useGitHubBackup.js`（只在设置页加载状态）、`useWorkspace.js` 负责 toast 和恢复后重载报告。

远端固定为默认分支上的 `toksight/usage.sqlite`。快照来自 `database.exportDatabase()`（`VACUUM INTO` 临时文件，只读本机库）。

## 设置与令牌

- 设置保存在 `<toksight-dir>/github-backup.json`：`repo`、可选 `token`、`lastBackup`、`lastRestore`。文件以临时文件 + 重命名原子替换，创建为 `0600`、目录 `0700`（Windows 继承用户目录的私有 ACL）。
- 令牌优先级：`TOKSIGHT_GITHUB_TOKEN` → `GITHUB_TOKEN` → GitHub CLI（`gh auth token --hostname github.com`）→ 设置文件。令牌来自环境变量或 gh 时页面禁用令牌输入框并注明来源；gh 生效时提示 gh 令牌通常权限较宽。
- API 和页面永远不返回令牌，只返回 `tokenSource`（`TOKSIGHT_GITHUB_TOKEN` / `GITHUB_TOKEN` / `gh` / `config` / `null`）与 `tokenSaved`。错误信息不包含令牌。

### GitHub CLI 检测

- `createGhProbe` 依次运行 `gh --version`、`gh auth token --hostname github.com`、`gh config get user --host github.com`。三条命令都只读 gh 的本地配置 / 凭据存储，不访问 GitHub API，因此状态接口仍然不联网；登录名取自 gh 本地配置（`hosts.yml` 中的 `user`），读不到时省略。
- 通过 `node:child_process` 的 `execFile` 直接运行（不经 shell），`windowsHide`、5 秒超时，环境追加 `GH_PROMPT_DISABLED=1`、`GH_NO_UPDATE_NOTIFIER=1`。未安装（ENOENT）、未登录（非零退出）、超时或输出不像令牌时静默跳过，回落到下一个来源；命令输出与错误不写日志、不返回。
- gh 令牌只保存在进程内存，从不写入 toksight 设置。检测结果缓存 60 秒（并发请求共享一次检测）；`GET /api/sync/status?refresh=1`（页面“重新检测”）以及每次上传 / 恢复都会强制重新检测。
- 状态返回 `gh: { installed, loggedIn, user, version }`。页面显示“未安装 gh / gh 未登录（提示运行 `gh auth login`）/ 已登录为 {user}”，gh 提供令牌时加“正在使用”徽标。
- 测试通过 `ghRunner`（`createGitHubBackup`）/ `syncGh`（`createWebDataService`）注入假 gh。
- 仓库写成 `owner/name`，也接受 `https://github.com/owner/name(.git)`。令牌留空表示保留已保存的令牌；`clearToken: true` 删除它。

## 上传

1. 导出快照；超过 **90 MiB** 直接拒绝（`SYNC_TOO_LARGE`，GitHub 单文件上限 100 MiB），不发起网络请求。
2. `GET /repos/{repo}`：仓库必须存在且 `private: true`，公开仓库拒绝（`SYNC_PUBLIC_REPO`），不写入任何内容。
3. 读取远端文件元数据；若 git blob sha 与本地快照相同，跳过上传（“已是最新”）。
4. ≤ 1 MiB 用 Contents API `PUT`（带旧文件 sha）；更大的快照用 Git Data API：blob → tree → commit → 非强制 `PATCH refs/heads/<默认分支>`。只有最后的引用更新让新提交可见，所以中途失败时远端仍是旧备份，可直接重试。空仓库先用 Contents API 写入 `toksight/README.md` 建立默认分支。
5. 成功后记录 `lastBackup { repo, branch, at, size, sha, commit }`。

## 恢复

1. 读取远端文件元数据；不存在时返回 `SYNC_NO_BACKUP`（HTTP 404）。
2. 通过 `git/blobs/{sha}`（raw）下载到内存，校验 git blob sha，与临时文件上的 `PRAGMA integrity_check`、`readDatabaseBackup` 的结构和内容验证一起完成后才继续；任一失败返回 `SYNC_BAD_BACKUP`，本机库不变。
3. 把当前库导出到 `<toksight-dir>/backups/before-github-restore.sqlite`（只保留最近一份），供手动回退。
4. 调用 `database.importDatabase`：与“导入数据库”相同的合并去重，单个 SQLite 事务，失败即回滚（`SYNC_MERGE_FAILED`，提示安全副本路径）。
5. 成功后记录 `lastRestore`，前端提示新增 / 补全 / 重复数量并重载报告。

## 错误

| code | HTTP | 场景 |
| --- | --- | --- |
| `SYNC_AUTH` | 502 | 401：令牌无效、过期或撤销 |
| `SYNC_FORBIDDEN` | 502 | 403 或写入时 404：需要该仓库的 Contents 读写（细粒度令牌另需 Metadata 只读） |
| `SYNC_REPO_NOT_FOUND` | 502 | 仓库不存在或令牌看不到 |
| `SYNC_RATE_LIMIT` | 502 | 429，或 403 且 `x-ratelimit-remaining: 0` / 次级限流；返回 `retryAt`（若可得） |
| `SYNC_OFFLINE` | 502 | 网络错误或超时（普通请求 30 秒，传输 10 分钟） |
| `SYNC_CONFLICT` | 409 | 409 / 422：远端在操作期间变化或引用无法快进 |
| `SYNC_GITHUB_ERROR` | 502 | 其他 GitHub 状态码 |
| `SYNC_PUBLIC_REPO`、`SYNC_NOT_CONFIGURED`、`SYNC_OFFLINE_MODE`、`SYNC_BAD_*` | 400 | 公开仓库、未配置、`--offline` 启动、参数或备份无效 |
| `SYNC_TOO_LARGE` | 413 | 快照超过 90 MiB（或远端超过 256 MB） |
| `SYNC_NO_BACKUP` | 404 | 远端还没有备份 |
| `SYNC_BUSY` | 409 | 已有备份或恢复在进行 |
| `SYNC_MERGE_FAILED` | 500 | 合并失败，已回滚 |

所有失败都不修改本机数据库，也不影响本地报告。前端按 code 显示本地化说明。

## HTTP 边界

`GET /api/sync/status`（只读本机设置与 gh 本地状态，不访问 GitHub API；`?refresh=1` 重新检测 gh）、`POST /api/sync/config`（JSON：`repo`、`token`、`clearToken`）、`POST /api/sync/upload`、`POST /api/sync/restore`。四个路由除常规回环 Host 与写请求 Origin 检查外，还要求请求来自本机回环地址；即使用 `--host 0.0.0.0` 启动，局域网客户端也会得到 `403 SYNC_LOCAL_ONLY`。

测试见 `test/ghsync.test.js`：内存假 GitHub（真实 blob sha、只能快进的引用）覆盖小 / 大文件上传、跳过未变化、中断后重试、恢复与安全副本、损坏 / 缺失备份、合并回滚、401 / 403 / 404 / 限流 / 离线、公开仓库、超限、并发与 HTTP 路由；gh 未安装 / 未登录 / 已登录 / 超时、缓存与强制重测、与环境变量和已保存令牌的优先级、令牌不泄露。
