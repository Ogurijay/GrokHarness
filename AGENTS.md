# Grok-Harness 规则 / Project Rules

Grok-Harness is a local Mac/Windows Electron shell for [Grok Build](https://github.com/xai-org/grok-build) over ACP. It does not rewrite the agent.

Grok-Harness 是本机 Mac / Windows Electron 壳：通过 ACP 驱动 Grok Build，不重写 agent。

Current version / 当前版本：**v0.7.0** (`package.json`)

---

## Versioning & changelog / 版本与更新日志

Every product iteration that lands on GitHub **must** bump the version and add a bilingual changelog entry.

每次把产品迭代推到 GitHub（push 默认分支、合并 PR、打 release）**必须**升版本号，并新增中英双语更新日志。

### Required steps / 必做

1. Bump `version` in `package.json` and `package-lock.json` (SemVer).
2. Add a new `## X.Y.Z — YYYY-MM-DD` section at the **top** of `CHANGELOG.md` (below the title). Each release has **中文** and **English**.
3. Keep ACP `clientInfo.version` in `src/main/agent-host.ts` in sync with `package.json`.
4. Tag the release `vX.Y.Z` when publishing.

1. 提升 `package.json` 与 `package-lock.json` 的 `version`（语义化版本）。
2. 在 `CHANGELOG.md` 标题下、**文件顶部**新增 `## X.Y.Z — YYYY-MM-DD`，中英双语。
3. `src/main/agent-host.ts` 里 ACP `clientInfo.version` 与 `package.json` 保持一致。
4. 发布时打 git tag `vX.Y.Z`。

### SemVer / 语义化版本

| Bump | When |
| --- | --- |
| `0.x.Y` patch | Bugfix, copy, small UI |
| `0.X.0` minor | New user-facing feature |
| `1.0.0` | First stable public cut |

| 升级 | 时机 |
| --- | --- |
| `0.x.Y` 补丁 | 修 bug、文案、小 UI |
| `0.X.0` 次版本 | 用户可见新功能 |
| `1.0.0` | 第一次稳定公开版 |

Local WIP commits do **not** need a bump. The bump happens on the GitHub iteration (the push/PR that ships the change).

本地未推送的 WIP commit **不必**升版本。升版本发生在这次迭代真正进 GitHub 时。

Do not push a product change without a changelog row. If multiple changes ship together, one version and one changelog section covering all of them.

没有对应更新日志的产品改动不要推 GitHub。同一批一起发布的改动共用一个版本号、一节日志。

---

## Product constraints / 产品约束

- Path A: talk to `grok agent serve` on `127.0.0.1` over ACP. Do not rewrite Grok Build.
- Do not bind the agent to `0.0.0.0` or expose it publicly.
- Do not commit secrets (`XAI_API_KEY`, `~/.grok/config.toml` credentials, S3 keys).
- User-facing settings write `~/.grok/config.toml` and must not display secret tables.

- 路径 A：经 ACP 连接本机 `127.0.0.1` 上的 `grok agent serve`，不要重写 Grok Build。
- 不要把 agent 绑到 `0.0.0.0` 或公开暴露。
- 不要提交密钥。
- 用户设置写入 `~/.grok/config.toml`，密钥类字段不得进界面。

## Desktop distribution / 桌面发布

- Windows builds use `npm run build:win`; generated installers and QA files stay in ignored `release/`.
- Preserve single-instance startup and orderly shutdown of only the app-owned agent. Window close hides to tray; tray Quit performs cleanup.
- Browser login delegates to the official CLI. App preferences may save the CLI path, never tokens or secrets.
- App updates use GitHub release installer assets and `latest.yml`, independently of Grok Build updates. Do not advertise source-only releases as installable updates.
- Current builds are unsigned; do not claim code signing or verified end-to-end upgrade until tested. Release steps: `docs/WINDOWS_DESKTOP.md`.

- Windows 安装包使用 `npm run build:win` 构建，产物及验收截图留在被忽略的 `release/`。
- 保留单实例启动和有序退出，只回收本应用启动的 agent；窗口关闭到托盘，托盘退出执行清理。
- 浏览器登录委托官方 CLI，应用配置只可保存程序路径，不保存密钥。
- 应用更新独立于 Grok Build 更新，不将只有源码的 release 当安装更新。
- 当前构建未签名；未经验证不得宣称签名或完整跨版本升级通过。发布步骤见 `docs/WINDOWS_DESKTOP.md`。
