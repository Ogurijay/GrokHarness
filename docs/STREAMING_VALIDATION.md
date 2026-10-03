# Streaming repair validation / 对话流修复验收

2026-10-02, local WIP version 0.6.0.

## Incident evidence / 故障证据

The reported video conversation stopped visibly at `image_gen`. Its local Grok log shows that the same session was loaded twice during the active prompt (20:45:55 and 20:46:08 on 2026-10-01, Asia/Shanghai). The agent continued: image generation finished at 20:46:10, video generation returned a ZDR error at 20:46:24, and the final explanation and turn completion were persisted at 20:46:31.

The previous `openSession` path cancelled even the selected active conversation, then kept `ignoreUpdates` enabled and dropped notifications during hydration. This is a reproducible explanation for the missing tool result and final answer. The original backend request did not stop after the first sentence.

这次视频请求另有独立限制：ZDR 模式未配置视频存储，视频工具返回错误。修复界面接收消息不等于解除该限制。隐私设置、凭据及原有会话未修改，也未重试视频生成。官方说明：[Video Output Storage under ZDR](https://docs.x.ai/build/settings/zdr-video-storage)。

## Changes / 修复

- Selecting the active busy conversation leaves its prompt and live timeline intact.
- Session loading buffers notifications and merges them with a fresh durable transcript using event IDs. It resets the cancelled-view filter and rejects stale load results.
- Explicit prompt completion finishes resumed streaming; an intermediate `response_completed` does not finish a turn.
- Messages separated by tools stay in chronological positions.
- ACP requests require a real response or a matching prompt completion. Partial output alone no longer converts a timeout into success; socket replacement cannot close the new connection's requests.

## Verification / 验证

- `npm run typecheck`: passed.
- `npm run test:stream`: 8 passed. Covers reselecting a busy conversation, hydration merging and deduplication, foreign-session events, terminal versus intermediate events, chronological message segments, partial-output timeout, matching prompt completion and socket failure.
- `npm run test:desktop`: 4 passed, 1 skipped (optional real-binary test).
- `npm run build`: passed.
- Real local Grok Build 1.0.44 and 1.0.46 ACP probes: two sequential `read_file` calls and final marker received; the prompt RPC returned at the end of the turn.
- The modified AgentHost with a real Grok Build 1.0.46 backend received both completed tools and the final answer, finished with `busy=false`, and did not cancel when the active session was selected during execution. Electron APIs and the app database were shimmed for this probe; it is backend integration evidence, not a native UI test.

Probe artifacts stay in ignored `release/qa/`. Each probe shut down only the backend it spawned. The unrelated user's Grok CLI was left running.

The repaired transcript loader was also checked against the user's original conversation: it recovered the completed image tool, failed video tool and final ZDR explanation.

## Local installed update / 本机安装更新

The fresh NSIS installer in `release/local-ui-update/` exited with code 0 and replaced the current-user installation. Installed `resources/app.asar` matches the package (SHA-256 `F499414F30C083383413F1A7C8B295691D754D3FB77B6F5EC70A8848193C57A2`) and differs from the previous archive. The installed main bundle contains the streaming repair.

Before relaunch, `state.sqlite`, `Preferences` and `Local State` retained their pre-install hashes. The old application and these profile files were backed up in `release/local-update-backup-20261002-013120/`. The installed application was relaunched; its window reported `Grok-Harness` and `Responding=true`, with one main process and its own Grok backend. The unrelated user's Grok CLI remained running.

Native UI interaction and actual media generation were not exercised in this repair run. Startup and archive verification establish that the repair is installed; the backend probe above validates prompt execution with shimmed Electron APIs, rather than the native desktop UI.
