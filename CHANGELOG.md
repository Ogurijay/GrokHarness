# Changelog / 更新日志

Every GitHub iteration must add a section here in both Chinese and English. See `AGENTS.md`.

每次推到 GitHub 的迭代都必须在此新增中英双语一节。见 `AGENTS.md`。

---

## 0.6.0 — 2026-10-01

### 中文

- 新增 Windows 当前用户安装包、桌面与开始菜单快捷方式，无需终端启动。
- 新增 Grok CLI / 登录凭据检查、官方浏览器登录和自定义 CLI 路径保存。
- 新增独立桌面应用更新检查、下载与重启安装；源码发行版不会被误判为可下载更新。
- 单实例启动唤回已有窗口，托盘退出先停止本应用的 Grok 后台。
- ACP 客户端版本从应用版本读取，避免安装包与握手版本不一致。

### English

- Added a per-user Windows installer with desktop and Start menu shortcuts.
- Added CLI and credential checks, official browser login, and persisted CLI selection.
- Added separate desktop app update checks, downloads, and restart-to-install; source-only releases are not installable updates.
- Added single-instance window restoration and orderly cleanup of the app-owned agent on tray Quit.
- ACP client version now follows the application version.

---

## 0.5.0 — 2026-09-17

### 中文

- 侧栏新增图片生成、视频生成、语音转写；点击后直接替换中间对话区，不再弹层。
- 统一资源库：汇总本机 `~/.grok/sessions` 里的生成图和视频，瀑布流管理；可再用提示、作参考、下载、删除、打开原对话。
- 生成走 Grok 原生命令 `/imagine`、`/imagine-video`；语音是听写转写。
- 输入法组字时回车只上屏，不再误发送；上屏后再按一次 Enter 才发送。
- 对话输入栏去掉「媒体」按钮；资源库的附件和发送按钮与对话输入栏同一套图标。

### English

- Sidebar modules for image gen, video gen, and speech-to-text replace the chat pane instead of opening a modal.
- Unified library scans generated images and videos under `~/.grok/sessions`; masonry gallery with prompt reuse, reference, download, delete, and open source chat.
- Generation uses native `/imagine` and `/imagine-video`; voice is dictation / transcription.
- IME Enter commits composition without sending; a second Enter sends.
- Composer media button removed; studio attach and send use the same icons as chat.

---

## 0.4.2 — 2026-09-16

### 中文

- 输入不再带动整页重绘：长对话里打字不再明显卡顿。

### English

- Typing no longer re-renders the whole app, so the composer stays responsive in long chats.

---

## 0.4.1 — 2026-09-15

### 中文

- 会话总用时改为 `x天x时x分x秒`。
- 思考默认收起；思考和操作都可以点开展开或折叠。

### English

- Session total duration uses `x天x时x分x秒`.
- Thoughts stay collapsed by default; thinking and tool rows can expand and collapse.

---

## 0.4.0 — 2026-09-14

### 中文

- 对话里的图片显示缩略图，可点开大图，可右键复制。
- 进行中显示本轮计时；结束后在底部给出会话耗时和 token。超过 24 小时显示为 `1d…`。
- 新增 token 用量页，按天热力图查看消耗。
- 追问跟随 Grok Build 原生设置：排队或注入，以及是否合并排队追问。
- 停止会真正取消本轮；强制打断在对话里标「已中断」，与更新打断分开。
- 后台任务接 ACP：顶部 `Tasks` 列表，输入框上方 `◎ N command still running`；有 task 时对话保持 running。
- 思考与操作按 Grok TUI 扁平行：`Thought for`、`Edit +n/-n`、搜索、Run 竖条；思考不再折进操作组。
- 输入框 Enter 发送，Ctrl+Enter 换行。

### English

- Images in the transcript show thumbnails, open full-size, and copy from the context menu.
- Live turn clock while generating; session duration and tokens at the end. Past 24 hours shows as `1d…`.
- Token usage page with a per-day heatmap.
- Follow-ups follow native Grok Build settings (queue vs steer, combine queued prompts).
- Stop actually cancels the turn; a forced interrupt is marked in the transcript and is distinct from an update interrupt.
- Background tasks from ACP: a Tasks list at the top, `◎ N command still running` above the composer; a session stays running while tasks are live.
- Thinking and tools render as Grok TUI rows (`Thought for`, `Edit +n/-n`, search, Run bar); thoughts are not folded into the tool group.
- Enter sends; Ctrl+Enter inserts a newline.

---

## 0.3.0 — 2026-09-14

### 中文

- 对话可上传、拖入、粘贴截图/图片/文件，Grok 按附件内容继续工作。
- 输入 `@` 可引用工作区文件或其他对话，被引用对话的摘要会带进这一轮。
- 思考与操作按时间插在对话对应位置；间隔较久的步骤不再并进同一组。
- Markdown 表格带单元格边框和表头底色。

### English

- Attach screenshots, images, and files from the picker, drag-and-drop, or paste; Grok works from that content.
- Type `@` to mention workspace files or other conversations; a referenced chat’s excerpt is included in the turn.
- Thinking and tool steps stay at their timestamps; bursts separated in time are no longer merged into one block.
- Markdown tables render with cell borders and a header background.

---

## 0.2.0 — 2026-09-14

### 中文

- 侧栏工作区和会话可拖拽改顺序；排序增加「自定义排列」，并记住。
- 思考和操作在内容到达前显示动态 `...` 占位对话框，开始流出后移除。
- 生成时不再锁死滚动：贴底才跟随最新输出，向上翻可自由看上文，减少窗口抖动。
- 已归档分组可多选或全部删除会话，删除前确认。
- 未选工作区时不再弹出目录框，默认用用户主目录。
- 发送 / 停止按钮只留在对话输入区，顶栏不再放停止按钮。

### English

- Drag to reorder sidebar workspaces and sessions; sort includes Custom and persists.
- Thinking and tool steps show an animated `...` placeholder until content streams in, then it is removed.
- Generation no longer locks the transcript: follow the live output only while pinned to the bottom; scrolling up stays put and the window shakes less.
- The Archived group can bulk-delete selected or all sessions, with a confirmation dialog.
- Starting a chat without a workspace no longer opens a folder picker; the user home directory is used.
- Send / Stop live only in the composer; the top bar no longer shows a stop button.

---

## 0.1.1 — 2026-09-11

### 中文

- 应用图标换成官方 Grok 标志。
- 自动批准、记住批准、批准条默认项移入设置；对话栏用一个选择器同时改模型和思考长度。
- 顶栏工作目录比会话标题更淡；执行中的对话在侧栏、顶栏和等待回复时显示 loading。
- 侧栏加宽 20px；滚动条 2px；按钮和折叠箭头略放大，展开/折叠带过渡。
- 分组排序和展开状态每次操作写入本地，下次启动还原。
- 额度从 `/usage`（`x.ai/billing`）读取，启动时同步，之后每 5 分钟刷新。
- 设置按钮放到左下信息栏（头像右侧）；账号弹出层点内部不再收起。

### English

- App icon is the official Grok mark.
- Auto-approve, remember-approvals, and the permission-bar default move to Settings; model and thinking length share one composer control.
- Workspace path in the top bar is fainter than the session title; running chats show a spinner in the sidebar, top bar, and while waiting for a reply.
- Sidebar is 20px wider; scrollbars are 2px; buttons and fold chevrons are slightly larger, with expand/collapse motion.
- Group sort and collapsed/expanded state persist on every change and restore on launch.
- Quota comes from `/usage` (`x.ai/billing`), synced on startup and every 5 minutes.
- Settings sits in the account bar to the right of the avatar; the account popover stays open when clicking inside it.

---

## 0.1.0 — 2026-09-11

### 中文

- 以 Electron + React 做本机 Mac / Windows 壳，经 ACP WebSocket 连接 `grok agent serve`（仅 `127.0.0.1`）。
- 从 `~/.grok/sessions` 加载本机会话，按工作区分组；支持置顶、归档、未读、重命名。
- 置顶只移动单条会话到「置顶」组，不把整个工作区一起置顶；取消后回到原工作区组。
- 对话列居中；思考块、工具链、折叠 diff、时间戳跟随 Grok 配置。
- 新对话与进行中的会话都可用下拉框改权限模式、记住批准、首次批准默认项。
- 工作区芯片可选目录，选中后用 × 清除（点一次即生效）。
- 设置写入 `~/.grok/config.toml`，与 Grok Build TUI 共用；不展示密钥。
- 检测到 Grok Build 新版本时，左下信息栏最右侧显示「更新」；更新会警告并标记中断的会话。
- 更新完成后用 Grok 把说明译成中文，追加到 `~/.grok/webui-changelog.zh.md`。
- Slash 命令上下键选择时，下拉列表跟随高亮项滚动。
- 侧栏可改分组 / 会话排序方式，并记住选择。

### English

- Local Mac/Windows Electron + React shell that drives `grok agent serve` over ACP WebSocket on `127.0.0.1` only.
- Loads local sessions from `~/.grok/sessions`, grouped by workspace; pin, archive, unread, rename.
- Pin moves a single session into a Pin group without pinning the whole workspace; unpin restores it to its workspace group.
- Centered transcript; thinking blocks, tool grouping, collapsed diffs, and timestamps follow Grok config.
- Permission mode, remembered approvals, and first-prompt default are dropdowns on new and in-progress chats.
- Workspace chip picks a folder; × clears it in one click.
- Settings write `~/.grok/config.toml` shared with the Grok Build TUI; secrets stay out of the UI.
- When Grok Build has an update, an Update control sits at the far right of the account bar; applying warns and flags interrupted sessions.
- After an update, Grok translates the notes to Chinese and appends them to `~/.grok/webui-changelog.zh.md`.
- Slash-command lists scroll with the highlighted item when using arrow keys.
- Sidebar group/session sort is configurable and persisted.
