# Session management / 会话管理

## Changes / 改动

- The sidebar and collapsed rail both expose **管理会话**. Session and workspace context menus can open the same manager with the relevant selection/filter.
- Search titles, directories, group names and IDs; select individual records or the current results. Selections survive filter changes and show a total count. Child-agent conversations are excluded from standalone selection.
- Batch pin/unpin, archive/unarchive, local deletion, and assignment to a custom group or the original workspace. Failed/skipped records remain selected, and feedback shows counts/errors.
- Create, rename and remove custom groups; reorder groups and conversations. Group membership is independent of the original `cwd` and persists in the existing local SQLite store. Removing a group retains its conversations. Sidebar folders can receive a conversation dragged onto their header.
- Local deletion moves the parent and its owned descendants into `.grok/session-cleanup-backups/<timestamp>-<id>/sessions/`, with a manifest of original/destination paths. It never runs `grok sessions delete` or deletes cloud history. Legacy single-session, archive and workspace deletion use the same path.
- Active/being-loaded sessions and families with an active child are excluded. The official active-session registry is checked before and during file moves. Invalid UUIDs and directories resolving outside the session root are rejected. Idle loaded sessions close before the files move, to prevent close-time persistence from recreating a removed directory.
- Opening the manager refreshes local records; the main sidebar also refreshes on window focus and every 30 seconds while visible, without canceling or loading the active conversation.

## Automated checks / 自动检查

- `npm run test:sessions`: 9 passed. Uses temporary Grok homes and real local SQLite persistence, with Electron/ACP shims; no Grok network calls.
- Covers persisted assignments/order, duplicate names, group removal preserving workspace, batch reversal, main/child selection boundaries, byte-identical parent/descendant backup, active parent/child protection, idle close-before-move, empty archive selection, legacy deletion consistency, invalid IDs and a symlink outside the session root.
- Existing streaming (8), subagent (6) and desktop rules (4, 1 optional skip) regressions passed.
- `npm run typecheck`: passed.

## Renderer verification / 界面验收

The real React renderer was exercised in the in-app browser with synthetic IPC responses. These checks are UI evidence, separate from real backend tests and installed-app verification:

- Prefix search and result selection; new custom group, batch assignment, rename, group and conversation order; reload retains fixture assignments/order.
- Batch pin/unpin and archive/unarchive; removing a group keeps the conversations; delete confirmation cancellation and completion; skipped running record and backup link.
- No child row in the manager. No fixture errors/unhandled rejections.
- Dark/light layouts inspected. At 640×560 and 400×640, document and content widths have no horizontal overflow; navigation and results scroll independently.
- Synthetic screenshots: `release/qa/session-manager-dark-20261010.png`, `release/qa/session-manager-light-20261010.png`.

## Requested cleanup / 本地清理

Local batch-cleanup verification moved 32 historical sessions in 32 `FX-0100`–`FX-0156` workspace directories to `~/.grok/session-cleanup-backups/20261010-170227-fx-batch`.

All remaining `.storyforge/fanqie_fill/FX-<digits>` session groups were removed locally, with 576 files hash-checked after the move. Other session directories were retained. Two unrelated summaries changed concurrently while the application was in use; they were not restored or modified by the cleanup.

No StoryForge project/output files or cloud sessions were removed in this follow-up cleanup.

## Installed application / 本机安装

- Built the renderer/main/preload and a local NSIS installer using the installed Electron distribution; installer exit code 0.
- Updated `%LOCALAPPDATA%/Programs/grok-harness` from `release/local-ui-update/Grok-Harness-Setup-0.6.0.exe` (local WIP build before the 0.7.0 source version bump). Existing app/profile backup: `release/local-update-backup-20261010-171545`.
- Installed archive equals the new package. SHA-256: `A06A968FB1DFCCC27933E406448F9266CFA53250D5252D68F115D4F4973F9274`.
- Archive inspection confirms management IPC, organization persistence and new renderer assets (`index-HdGQC5s_.js`, `index-Db-cnnIz.css`). Development QA fixtures are excluded.
- The installer preserved `state.sqlite`, `Preferences` and `Local State` byte-for-byte before relaunch.
- Relaunched the installed executable; it reports responding, has the expected window title and exactly one app-owned Grok backend. Final filesystem scan found zero `FX-<digits>` workspace groups.
- Installed management UI interactions were not exercised. Renderer interaction evidence above comes from the synthetic browser fixture; backend behavior and installation were checked independently with tests and shell/file tools.
