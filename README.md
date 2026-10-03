# Grok-Harness v0.6.0

Local Mac / Windows desktop shell for [Grok Build](https://github.com/xai-org/grok-build). The window talks to a local agent over ACP; it does not rewrite Grok.

本机 Mac / Windows 桌面壳：窗口里管 Grok Build，经 ACP 连接本机 agent，不重写 Grok。

```
Grok-Harness (Electron)
    │ ACP / WebSocket bound to 127.0.0.1 only
    ▼
grok agent serve
```

Auth and sessions stay in `~/.grok` (`grok login` or `XAI_API_KEY`).

认证和会话沿用 `~/.grok`（先 `grok login` 或设置 `XAI_API_KEY`）。

## Windows app / Windows 安装版

Run `Grok-Harness-Setup-0.6.0.exe` to install for the current Windows user. Launch from the desktop or Start menu; Node.js is not required for the installed application. Grok Build remains a separately installed official CLI.

运行 `Grok-Harness-Setup-0.6.0.exe` 为当前 Windows 用户安装，随后通过桌面或开始菜单双击启动；安装版无需 Node.js，但仍需要单独安装官方 Grok Build CLI。

First launch checks the CLI and saved credentials. Missing prerequisites open the desktop panel automatically. Browser login uses the official `grok login --oauth`; credentials stay in `~/.grok`. The account menu and tray both provide “桌面应用与更新”. Closing the window keeps the tray running; tray Quit stops only this app's agent process. A second launch restores the existing window.

首次启动检查 CLI 和已有凭据，缺项时自动打开桌面面板。浏览器登录走官方 `grok login --oauth`，凭据仍由 `~/.grok` 管理。账户菜单和托盘均有“桌面应用与更新”。关闭窗口保留托盘；从托盘退出会停止本应用自己的 agent，重复启动则唤回已有窗口。

App updates and Grok Build updates are independent. App updates require a GitHub release containing the Windows installer and `latest.yml`; source-only releases are not downloadable app updates. Current local installers are unsigned. See [Windows distribution](docs/WINDOWS_DESKTOP.md).

应用更新与 Grok Build 更新独立。GitHub 发行版需要同时提供 Windows 安装包和 `latest.yml`，只有源码的发行版不算可下载的应用更新。本地安装包尚未签名。详见 [Windows 发布说明](docs/WINDOWS_DESKTOP.md)。

## Development requirements / 开发要求

- Node.js 22+
- Official `grok` CLI (`GROK_BINARY` → `~/.grok/bin/grok` → `PATH`)

## Develop / 开发

```sh
git clone https://github.com/Ogurijay/GrokHarness.git
cd GrokHarness
# If Electron download hangs in China:
#   $env:ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/"
npm install
npm run dev
```

Probe handshake without a window / 不启动窗口只测握手：

```sh
npm run probe
```

Build the Windows installer / 构建 Windows 安装包：

```sh
npm ci
npm run build:win
```

Output / 输出：`release/Grok-Harness-Setup-0.6.0.exe`.

## Versioning / 版本

Every GitHub iteration **must** bump `package.json` version and add a bilingual section to `CHANGELOG.md`. Rules: [`AGENTS.md`](./AGENTS.md).

每次迭代到 GitHub **必须**升版本号并在 `CHANGELOG.md` 新增中英双语说明。规则见 [`AGENTS.md`](./AGENTS.md)。

Current / 当前：**v0.6.0**

## Safety / 安全

- Agent listens on `127.0.0.1` only
- Per-launch random serve secret; not exposed to the renderer
- Do not bind serve to `0.0.0.0` or a public host

- agent 只听 `127.0.0.1`
- 每次启动生成随机 secret，不进渲染进程
- 不要把 serve 绑到 `0.0.0.0` 或挂到公网
