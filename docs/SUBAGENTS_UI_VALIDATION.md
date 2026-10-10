# Sidebar, subagents and thought preview / 侧栏、子代理与思考预览

2026-10-10, local WIP version 0.6.0.

## Behavior / 行为

- The sidebar starts at 360px, supports dragging its right edge, arrow-key adjustment and double-click/Home reset. The supported range is 280–520px. Existing v1 appearance preferences migrate to wider values while retaining theme and text size; v2 stores subsequent adjustments.
- Official `session_kind=subagent` sessions and sessions owned by a parent's `subagents/<id>/meta.json` are excluded from the sidebar, archive list and conversation search. Ordinary forks remain top-level conversations. No stored conversation is deleted.
- The parent conversation contains a collapsible subagent list. A read-only detail dialog shows task, status, model, tools, thinking, messages and nested child navigation. The list polls every 3 seconds and the open child every 2.5 seconds without calling ACP `session/load` or cancelling the parent.
- Thought blocks start collapsed with a 72px scrolling preview. New chunks follow the bottom until the user scrolls upward; returning to the bottom resumes following. The toggle displays the full Markdown content. Completion does not change the user's chosen expanded state. Live headings update their elapsed time every second.
- Transcript IDs remain stable across read-only polling so folds survive updates. Newly created children without an `updates.jsonl` file render an empty state.

## Evidence / 证据

The local session inventory contained 99 summaries marked `subagent` and 100 child metadata records. Official storage layout is documented in [Grok Build session management](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md). Recent local ACP records still emit `agent_thought_chunk` with text content, event IDs and stream timestamps; the existing incremental transport remains in use.

- `npm run typecheck`: passed.
- `npm run test:subagents`: 6 passed. Covers child ownership, missing legacy kind markers, ordinary forks, worktree transcripts, nesting, live metadata, stable IDs, missing update files, malformed metadata and unowned/traversal IDs.
- `npm run test:stream`: 8 passed.
- `npm run test:desktop`: 4 passed, 1 skipped (optional binary test).
- `npm run build`: passed.

The real React renderer was tested in the in-app browser with synthetic IPC. The old 260px preference migrated to 360px; child rows were absent from the sidebar. Child tools and nested navigation were available, while the parent stayed busy. Thinking started collapsed, followed new output, paused after manual upward scrolling, expanded fully, and stayed collapsed when a turn finished in the collapsed state. Sidebar keyboard adjustments persisted after reload. There were no collected runtime errors. At 880×560 and 640×560, document width equalled viewport width and the dialog had no horizontal overflow; the small layout hides the dialog navigation column.

Synthetic screenshots are in ignored `release/qa/subagent-detail-20261010.png` and `thought-preview-20261010.png`. They validate renderer behavior, not live child execution. No new AI prompt or subagent task was launched for these checks.

## Local installation / 本机安装

The NSIS installer exited with code 0. Installed `resources/app.asar` matches the new package (SHA-256 `7542EB496D3F314B782CA03F84F8B803F90EEB3E2AE162A57DECC8F22A6B7FCC`) and differs from the previous archive. The installed bundle contains both new IPC handlers. Before relaunch, `state.sqlite`, `Preferences` and `Local State` retained their pre-install hashes. The old installation and those files are backed up under `release/local-update-backup-20261010-100708/`.

The installed program was relaunched and reported `Responding=true`; its native window showed the widened sidebar. A native drag attempt was blocked by the desktop tool's user-input protection, so native dragging and child navigation are not claimed as tested. Their interactions were verified in the synthetic browser fixture above. The unrelated Grok CLI process was preserved.

A read-only probe using the production session parser found 431 real local sessions, with 332 main sessions and 99 hidden children. It read 30 children under a real parent and one child transcript containing 158 timeline items and 105 tools. No ACP session switch, new prompt or child task was issued by this probe.
