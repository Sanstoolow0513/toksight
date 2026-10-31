# Windows 原生桌面实验版

`exp` 分支增加 C# / WinUI 3 / XAML 桌面客户端，保留现有 CLI 和 Web。界面没有 WebView2、Electron 或浏览器页面；`frontend/out/` 不参与桌面构建。Node 采集、SQLite、价格与备份逻辑仍直接复用 `src/`，不另写一套统计口径。

## 当前范围

窗口提供今天、日历、价格、设置四页，沿用素面工作台的平面分区、橙色强调、灰阶热图和明暗主题。原生控件布局与动效独立实现，不承诺与 Web 像素一致。

| 页面 | 原生界面 |
| --- | --- |
| 今天 | KPI、时段分布、Token 构成、Agent / 模型和会话、订阅额度、近期趋势 |
| 日历 | 大 / 紧凑布局、日期和整周选择、选区汇总、时段 / Agent / 模型 / 会话明细 |
| 价格 | 初始化、本地继续、搜索与厂商过滤、用过的模型、单价明细、更新与重置 |
| 设置 | 语言、配色、时区、SQLite 备份与合并、GitHub 手动备份与恢复 |

图片导出走原生渲染和 Windows 文件选择器。当前日历 PNG 导出选区详情，不包含 Web 版的可见月份拼接；需要完整 Web 导出布局时继续使用 `toksight web`。纯原生日历的缩放、鼠标与键盘交互需单独验收，不能用 Web 测试代替。

日历先显示最近 12 个月，可加载全部历史；支持按钮和 Ctrl + 滚轮切换大小布局，当前没有双指捏合。价格库尚未初始化时先进入原生价格页完成下载或选择本地继续。

目标为 Windows 10 2004（build 19041）及以上；本轮以 Windows x64 为主要验证环境。工具支持生成 ARM64，ARM64 设备和 Windows 10 尚需单独验证。发布包携带 Node、.NET 和 Windows App SDK 运行时，用户无需安装 Node 或 .NET；开发机需要构建工具。

## 开发与运行

开发环境：Windows、Node >=22.5、.NET 10 SDK，以及 Windows SDK。首次恢复 NuGet 包和准备固定 Node 运行时需要网络。MSIX 打包需要 Windows SDK 的 `MakeAppx.exe`；生成传统安装器额外需要 Inno Setup 6.3+。脚本不自动安装系统构建工具。

```powershell
npm run desktop:build
npm run desktop:run
npm run desktop:run -- --offline
```

`desktop:build` 固定使用 Release、self-contained publish 和 NuGet locked restore，输出 `dist/desktop/win-x64/app/`。这是包含运行时的完整目录，不能只复制其中的 EXE。运行入口为 `Toksight.Desktop.exe`；`desktop:run` 启动已有构建，不自动重编译。

```powershell
# 单独准备运行时，或使用预下载的精确官方 ZIP 离线构建
npm run desktop:runtime
npm run desktop:build -- --runtime C:\downloads\node-v24.22.2-win-x64.zip

# ARM64：可构建，尚未在 ARM64 设备验收
npm run desktop:build -- --arch arm64
npm run desktop:run -- --arch arm64
```

`desktop/runtime.json` 锁定 Node **24.22.2**、官方 URL 与 x64 / ARM64 ZIP 的 SHA256；校验值来自 [Node 官方 SHASUMS256.txt](https://nodejs.org/dist/v24.22.2/SHASUMS256.txt)。构建不会追随 `latest` 自动升级。每次准备运行时都校验 ZIP，只提取 `node.exe` 和 `LICENSE` 至 `desktop/runtime/win-<arch>/`。下载缓存位于 `desktop/.cache/`；两者都不提交 Git。`--runtime` 接受匹配锁定版本和架构的官方 ZIP，不接受任意未校验的 `node.exe`。

升级运行时需一起修改 `runtime.json` 中版本、URL、文件名和两架构 SHA256，重新验证 sidecar、SQLite 及原生发布包。NuGet 依赖由 `desktop/Toksight.Desktop/packages.lock.json` 锁定，更新依赖后先更新锁再发布。

## 数据与服务进程

```text
Toksight.Desktop.exe（WinUI 3 / XAML）
  -> backend/node.exe backend/desktop/service.mjs
       -> 127.0.0.1:随机端口，只提供 JSON API
       -> 原 src/ 采集、定价、SQLite 与备份逻辑
```

应用私有的 `backend/` 含 Node、`NODE-LICENSE`、`desktop/service.mjs`、`src/` 和根 `package.json`，保持源码相对路径。窗口创建随机 32 字节令牌，通过 stdin 首行发送；所有 HTTP 请求带 `X-Toksight-Desktop-Token`。服务在解析路由前用固定长度 `timingSafeEqual` 验证，原有 Host / Origin 防护继续执行。

stdin 首行是 `{ "token": "<64 hex>", "offline": false }`，可加绝对路径 `configDir` / `home`；未配置的字段应省略，不传 `null`。stdout 仅输出一行 `{ "type": "ready", "url": "http://127.0.0.1:<port>" }`；错误 JSON 和诊断走 stderr。宿主持续读取 stderr，并保持 stdin 打开。`{ "type": "shutdown" }` 或 EOF 关闭服务与数据库，超过 5 秒强制结束；宿主另有退出兜底。

- **统计数据库与价格**：默认继续用 `~/.config/toksight/`，遵守 `TOKSIGHT_CONFIG_DIR` 和已有 `XDG_CONFIG_HOME` 优先级。桌面、CLI 和 Web 可以读取同一份已提交快照，不迁走旧数据。
- **桌面偏好**：语言、配色、时区和日历档位在 `LocalApplicationData/toksight/desktop/preferences.json`，普通安装即 `%LOCALAPPDATA%\toksight\desktop\preferences.json`；MSIX 下最终存储映射受 Windows 包身份影响。
- **隔离验收**：`TOKSIGHT_DESKTOP_STATE_DIR` 可覆盖桌面偏好目录，与临时 `TOKSIGHT_CONFIG_DIR` / `TOKSIGHT_DESKTOP_HOME` 一起使用，避免测试改动个人偏好或读取真实来源。
- **Agent 来源**：沿用所有现有来源环境变量，只读 Agent 文件。`TOKSIGHT_DESKTOP_HOME` 可为桌面宿主注入隔离 home，主要用于 fixture 验证；它不会覆盖显式 Agent 来源环境变量。
- **GitHub 凭据**：沿用现有 GitHub 备份模块和凭据优先级，不把 token 放入桌面偏好或服务启动命令行。存储机制见[GitHub 备份](github-backup.md)。

关闭窗口结束其拥有的 sidecar。桌面版不监听固定 4729，也不打开浏览器。`--offline` 禁用价格下载和 Kimi 额度联网刷新，含义遵循已有 API。

## 两种分发产物

```powershell
npm run desktop:package
# 已完成 publish 时复用当前产物
npm run desktop:package -- --no-build
```

结果位于 `dist/desktop/win-x64/`：

| 产物 | 用途与更新 |
| --- | --- |
| `toksight-<version>-win-x64.zip` | 解压完整目录直接启动，数据仍在用户目录；目前手动替换完整发布目录更新 |
| `toksight-<version>-win-x64.msix` | 未签名 MSIX，供后续签名测试或准备 Store 提交；不是双击即可安装的最终发布包 |
| `toksight-<version>-win-x64-setup.exe` | 检测到 Inno Setup 6.3+ 才生成；当前用户安装，不要求管理员权限；目前通过新安装包手动更新 |
| `msix/AppxManifest.xml`、`package-info.json` | 可检查的包身份、权限、架构和产物记录 |

MSIX 默认身份是实验身份。Store 提交前从 Partner Center 取得自己的 Package Identity / Publisher，显式传入：

```powershell
npm run desktop:package -- --no-build `
  --identity YourPartnerCenter.PackageName `
  --publisher "CN=YOUR-PUBLISHER-ID" `
  --publisher-name "Your Publisher Name"
```

`--makeappx C:\path\MakeAppx.exe` 可以覆盖 SDK 自动发现。MSIX 声明 `runFullTrust`，容纳原生 Win32 应用与随包 Node 子进程。它没有被转换成 UWP 沙盒应用，也不会因为 Store 渠道自动变成另一套 UI。当前脚本**不签名、不上传 Store、不发布 GitHub Release**。签名、真实包安装、更新 / 卸载、双渠道切换和 Store 审核仍需后续发布验证；成功执行 MakeAppx 只证明打包格式通过工具检查。

若本机没有 Inno，ZIP 和 MSIX 仍会生成。安装好 Inno 后可再次执行 `desktop:package -- --no-build`，或直接编译模板：

```powershell
& 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' `
  "/DSourceDir=$((Resolve-Path dist/desktop/win-x64/app).Path)" `
  "/DOutputDir=$((Resolve-Path dist/desktop/win-x64).Path)" `
  /DAppVersion=1.3.0 /DAppArch=x64 /DOutputBaseFilename=toksight-1.3.0-win-x64-setup `
  desktop/installer.iss
```

安装器只管理程序目录，不删除统计库和桌面偏好。Store / MSIX 安装的更新由对应分发方案处理；官网安装器目前没有自更新服务。

## 验证

```powershell
npm test
node --test test/desktop-service.test.js test/webserver.test.js
npm run desktop:build
npm run desktop:check
npm run desktop:check -- --fresh
npm run desktop:package -- --no-build
```

sidecar 测试使用临时 home 和离线 fixture，覆盖启动、令牌拒绝、不同宿主隔离、已提交快照 / 刷新、错误协议、EOF / 关闭与有限退出时间。

`desktop:check` 使用独立 fixture 和偏好目录启动已有桌面构建，不使用真实 Agent 数据。它以「浅色 / 宽窗口 / 中文」和「深色 / 窄窗口 / 英文」两组配置遍历四页，生成 **8 张原生 PNG**，检查页面错误、柱条非零宽度以及设置控件没有越出视口，完成后退出。`desktop:check -- --fresh` 则使用没有用量、未初始化价格库的新用户状态，额外验证首次导航进入价格引导，并重复上述页面检查。结果和截图在 `dist/desktop/checks/`，供人工检查实际像素内容。

WinUI 仍需要在实际窗口检查缩放 / 键盘操作、文件选择器及导出图片；自动冒烟不能替代完整交互验收。Web 与 npm 包继续按原检查执行，桌面目录不进入 npm 的 `files` 白名单。

## Windows CI

[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) 在 PR 修改 `desktop/**`、`scripts/desktop-*.js` 或自身时运行，也支持 `workflow_dispatch` 手动触发。Windows runner 恢复锁定 NuGet 包，验证离线 sidecar，构建 x64 自包含应用，生成 ZIP / 未签名 MSIX 并上传工件；存在 Inno 时可附带安装器。它不提交 Store，不签名，也不创建正式 Release。

托管 runner 的后台会话没有可依赖的交互桌面，因此 CI 不运行 `desktop:check`。两组原生截图及新用户流程在本机交互会话验收。ARM64 暂不纳入此工作流。
