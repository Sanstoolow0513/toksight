# Windows 桌面实验版（Tauri）

`exp` 分支使用 **Tauri 2 / Rust + 现有 Next 静态前端**。今天、日历、价格和设置直接复用 `frontend/` 的 React、CSS、Geist 字体、Lucide 图标及动画；窗口、文件保存和外部链接由桌面宿主处理。Windows 上页面由 WebView2 渲染。此前的 WinUI / XAML 独立界面已移除，不再维护两套页面。

Node 采集、SQLite、价格与 GitHub 备份仍复用 `src/`，CLI 和 Web 保留。桌面版不是依赖在线网站的快捷方式：前端静态资源编入应用，Node 运行时与服务源码随包分发，离线也能读取本地数据。

## 开发与运行

Windows 开发机需要 Node >=22.5、Rust 的 MSVC 工具链、Microsoft C++ Build Tools / Windows SDK，以及 WebView2。安装要求见 [Tauri 官方前提](https://v2.tauri.app/start/prerequisites/)。不再需要 .NET、Windows App SDK 或 Inno Setup。首次恢复 npm / Cargo 依赖、准备固定 Node 运行时与 NSIS 工具需要网络。

```powershell
npm run web:ci
npm run desktop:ci
npm run desktop:dev
```

开发使用同一套前端。发行构建将 `frontend/out/` 静态文件嵌入 Tauri；API 通过桌面 IPC 调用本地数据服务，不依赖开发用的 4729 端口。

```powershell
npm run desktop:build
npm run desktop:check
npm run desktop:run
npm run desktop:run -- --offline
```

`desktop:build` 生成 Release 应用，输出 `dist/desktop/win-x64/tauri/app/`。入口为 `toksight-desktop.exe`；必须保留整个目录，不能只复制 EXE。`desktop:run` 启动已有构建，不自动重编译。重新构建前应关闭这个发布目录中的实例。

桌面工具依赖由 `desktop/package-lock.json` 锁定，Rust 依赖由 `desktop/src-tauri/Cargo.lock` 锁定。根 npm 包仍无运行时依赖。生成目录、Cargo 编译产物、运行时缓存和 `dist/` 不提交 Git。

应用和安装器的版本通过 `tauri.conf.json` 的 `version: "../../package.json"` 读取根包；原 `release:version` 流程仍是发布版本来源。私有桌面 npm 包及 Rust crate 的版本是内部构建元数据。

### 随包 Node

```powershell
npm run desktop:runtime
npm run desktop:build -- --runtime C:\downloads\node-v24.22.2-win-x64.zip
```

`desktop/runtime.json` 锁定 Node **24.22.2**、官方 URL 与 x64 / ARM64 ZIP 的 SHA256；校验值来自 [Node 官方 SHASUMS256.txt](https://nodejs.org/dist/v24.22.2/SHASUMS256.txt)。每次准备运行时都校验 ZIP，只提取 `node.exe` 和许可证至 `desktop/runtime/win-<arch>/`，下载缓存位于 `desktop/.cache/`。`--runtime` 只接受匹配锁定版本和架构的官方 ZIP。

用户无需另装 Node、Rust 或 .NET。Windows 运行依赖 WebView2；安装器会处理缺失的 WebView2，便携 ZIP 的使用者需要系统已有该运行时。当前验收以 Windows x64 为主；ARM64 需要相应 Rust target / C++ 工具链并单独进行设备验收，不应由 x64 的成功构建推断兼容性。

## 数据与服务进程

```text
toksight-desktop.exe
  ├─ WebView2：内嵌 frontend/out/，同一套 Web UI
  └─ Rust IPC：限定的 API、保存文件、打开外部链接
       └─ backend/node.exe backend/desktop/service.mjs
            └─ 127.0.0.1:随机端口 + 会话令牌 → 原 src/ 数据核心
```

`backend/` 包含 Node、`NODE-LICENSE`、`desktop/service.mjs`、`src/` 和根 `package.json`，保持原模块相对路径。Rust 宿主创建随机 32 字节令牌，通过 stdin 首行传给子进程。它转发允许的 API 路径、方法和正文，并附加 `X-Toksight-Desktop-Token`；令牌和私有端口不交给页面。前端不能把桥接命令当作任意网络代理或任意文件路径写入器。

服务在解析路由前以固定长度 `timingSafeEqual` 验证令牌，原有 Host / Origin 防护继续执行。stdin 首行是 `{ "token": "<64 hex>", "offline": false }`，可加绝对路径 `configDir` / `home`；未配置的字段省略，不传 `null`。stdout 只输出一行 `{ "type": "ready", "url": "http://127.0.0.1:<port>" }`，诊断写 stderr。宿主保持 stdin 打开；`{ "type": "shutdown" }` 或 EOF 关闭服务与数据库，服务有 5 秒退出上限。关闭应用同时结束它拥有的服务。

- **统计数据库与价格**：默认仍用 `~/.config/toksight/`，遵守 `TOKSIGHT_CONFIG_DIR` 和已有 `XDG_CONFIG_HOME` 优先级。桌面、CLI 和 Web 共用已提交快照。
- **界面偏好**：沿用前端 localStorage，保存在桌面专用 WebView2 用户数据目录；浏览器 Web 偏好与桌面偏好相互独立。不会读取旧 WinUI `preferences.json`。
- **隔离验收**：`TOKSIGHT_DESKTOP_STATE_DIR` 覆盖 WebView2 状态目录，配合临时 `TOKSIGHT_CONFIG_DIR` / `TOKSIGHT_DESKTOP_HOME` 使用。完整隔离还必须清理继承的 Agent 来源与凭据环境变量。
- **Agent 来源**：保持现有来源优先级，只读 Agent 文件。`TOKSIGHT_DESKTOP_HOME` 可注入测试 home，不覆盖显式来源环境变量。
- **GitHub 凭据**：沿用[GitHub 备份](github-backup.md)模块的优先级，不把 token 放进桌面偏好或子进程命令行。

PNG 与 SQLite 导出使用系统保存对话框；取消保存不会报告导出成功。图片内容继续由同一前端导出逻辑生成。外部 HTTP(S) 链接交给系统浏览器，应用窗口保留在本地页面。

桌面桥接对单次导入、响应和保存限制为 256 MiB，二进制以 base64 经 IPC 传输，内存占用会高于原文件大小。超过此限制的完整数据库导出应使用 CLI `toksight export-db <文件>`。前端中止请求会停止等待并忽略过期结果，不会撤销已提交的刷新、导入或备份操作。

`--offline` 沿用现有 API 含义，禁用价格下载和 Kimi 额度联网刷新；它不是针对显式 GitHub 备份操作的全局网络沙盒。

## 分发与 Microsoft Store

```powershell
npm run desktop:package
# 复用已构建的应用
npm run desktop:package -- --no-build
# 使用含 WebView2 离线安装程序的分发配置
npm run desktop:package -- --no-build --store
```

结果位于 `dist/desktop/win-x64/tauri/`：

| 产物 | 使用方式 |
| --- | --- |
| `toksight-<version>-win-x64.zip` | 解压整个目录，运行 `toksight-desktop.exe`；手动替换整个程序目录更新 |
| `toksight-<version>-win-x64-setup.exe` | NSIS 安装器，负责安装、快捷方式和卸载入口；目前手动安装新版本更新 |
| `package-info.json` | 本次打包的版本、架构与产物信息 |

当前打包流程不再生成 MSIX。默认 NSIS 配置在需要时下载 WebView2；`--store` 合并离线 WebView2 安装配置，包体更大，可用于后续 Microsoft Store 的 EXE / MSI 应用渠道准备。WebView2 分发选项见 [Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)。

Store 渠道和官网下载使用同一个应用界面与数据核心。Store 是安装发现和分发入口，不会把应用转换成另一套原生控件。Tauri 的这条 Store 路线是 Partner Center 中的 **EXE or MSI app**，不是 MSIX / UWP；Store 提交还需要离线安装、代码签名、更新方案和静默安装参数，NSIS 使用大写 `/S`。详见 [Tauri Microsoft Store 指南](https://v2.tauri.app/distribute/microsoft-store/)。

**`--store` 成功不等于可以直接上架。** 本仓库脚本不签名、不上传 Store、不发布 Release，也未实现自动更新服务。正式分发前仍须验证安装、覆盖更新、卸载、WebView2 缺失时的安装以及 Store 要求。

## 验证与 CI

```powershell
npm test
npm run web:build
npm run check:package
npm run desktop:build
npm run desktop:check
npm run desktop:package -- --no-build
```

sidecar 测试使用临时 home 和离线 fixture，覆盖启动鉴权、不同宿主隔离、快照刷新、错误协议、EOF 与退出时限。Rust 测试检查 IPC 路由与输入边界。前端桥接检查覆盖 Web / 桌面请求和二进制传输。

`desktop:check` 使用隔离数据及 WebView2 状态启动实际应用，通过开发工具连接检查四页、明暗主题和桌面 API 桥接；`desktop:check -- --fresh` 检查首次价格初始化引导。结果保存于 `dist/desktop/checks/`。自动冒烟不代替文件选择器、键盘 / 鼠标手感以及安装 / 卸载验收。Web 与 npm 包仍走原检查，桌面目录不进入 npm 的 `files` 白名单。

[Windows 桌面 CI](../.github/workflows/desktop.yml) 恢复锁定的前端、桌面工具和 Rust 依赖，构建 x64 应用并上传 ZIP / 未签名 NSIS 安装器。它不签名，不创建正式 Release，也不提交 Store。需要交互桌面的检查在本机执行；ARM64 设备验收另行进行。
