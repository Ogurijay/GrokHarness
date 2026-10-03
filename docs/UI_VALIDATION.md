# UI phases 1–2 validation / 界面第一、二阶段验收

2026-10-01 · local WIP based on v0.6.0. Reference parameters and adaptations: [UI_REFERENCE.md](UI_REFERENCE.md).

## Checks completed

- `npm run typecheck`: passed after the final source changes.
- `npm run build`: passed; renderer assets `index-CWbfiZwT.css`, `index-BIQLdCDs.js` after the sidebar refinement.
- `npm run test:desktop`: 4 passed, 1 skipped. The optional in-flight cancellation case requires `GROK_TEST_BINARY`.
- Windows directory package: passed with the existing Electron 35.7.5 distribution. The normal archive-extraction route failed with Windows `EPERM` on directory rename, including a fresh output directory. No running app was stopped and no permissions were changed.

```powershell
npx electron-builder --win --x64 --dir --publish never --config.directories.output=release/ui-preview-final --config.electronDist=node_modules/electron/dist
```

Output: `release/ui-preview-final/win-unpacked/Grok-Harness.exe`. Keep the entire directory together. This is a local preview, not a published release or installer. The package's `app.asar` contains the final renderer assets and excludes the development fixtures.

## Renderer checks / 页面与交互

The in-app browser loaded the real renderer components through an ignored fixture under `release/qa/`. IPC, account status, sessions, media and replies were synthetic; the fixture never read credentials or started Grok.

| Surface | Verified behavior |
| --- | --- |
| Application frame | Expanded and collapsed navigation; home/chat/media switching; inspector toggle |
| Window sizes | 1280 × 840 application default; 880 × 560 minimum, including inspector and settings; no document horizontal overflow at the minimum |
| Appearance | Light/dark surfaces; persisted 16px message text and 280px sidebar confirmed after reload, then reset to 14px/260px |
| Search | Title/project filtering; Enter opens the result and closes the dialog; initial input focus; Ctrl K; Escape returns focus |
| Composer | Chinese text submission; attachment chips and submitted attachment; session mention selected with Enter; slash command choices; running-turn follow-up queue |
| Permission | Approval choices visible; chosen approval clears the request; dark button foreground/background contrast corrected |
| Settings | Categories; global field search; actual existing controls; desktop preferences separate from Grok CLI/TUI configuration |
| Account and updates | Account category, local usage heatmap, desktop application panel and Grok Build changelog, switching through settings links |
| Media | Image/video empty states, voice library, transcript preview, chat image preview |
| Shared dialogs | Labels, Escape, Tab/Shift Tab containment and focus restoration |

No errors were recorded by the fixture's error/unhandled-rejection collector during the exercised interactions. IME composition guards remain in the extracted composer and in search; actual OS input-method candidate selection was not exercised.

Screenshots are ignored local evidence:

- `release/qa/chat-light.jpg`
- `release/qa/settings-light.jpg`, `settings-dark.jpg`, `settings-narrow-dark.jpg`
- `release/qa/chat-narrow-dark.jpg`
- `release/qa/media-dark.jpg`, `media-preview-dark.jpg`
- `release/qa/usage-dark.jpg`, `desktop-dark.jpg`, `queue-dark.jpg`, `home-light.jpg`

## Remaining runtime verification / 验证边界

Native desktop control is unavailable in this session. Windows caption buttons, dragging, tray hide/restore, macOS traffic lights, real login, ACP streaming, microphone recording, real media generation and actual update installation were not verified end to end. The implementation retains the existing backend/lifecycle paths; the browser checks establish renderer behavior only.

For a separate preview, first exit the installed app via its tray menu so the existing single-instance guard does not return to the installed window.

Full Git review, terminal and file editor remain outside phases 1–2.

## Sidebar refinement / 侧栏细化

2026-10-01, following the user's Codex screenshot:

- Conversation rows use 14px titles and 30px single-line height; project titles use 14px regular weight, section titles use 14px semibold. Dates and counts are visually hidden.
- Pinned rows are flat; project conversations align with the project name, using 24px additional indentation. Projects display open/closed folder icons tied to their existing collapse state.
- Conversation-row `⋯` buttons were removed. Right-click still opens the existing rename, copy, workspace, pin, archive and delete menu. Project/group menus remain available.
- Pin controls hide on active, pinned and ordinary rows until row hover; keyboard focus on the pin also reveals it. Moving the pointer away hides it again.
- The project toolbar follows pinned conversations. All three toolbar buttons use 26px square areas, centered 16px icons with identical vertical coordinates.

The real renderer with synthetic IPC was checked for hover/leave, cancel pin and movement back into the project, project collapse/open icon changes, expand all, right-click and sorting menus, and light/dark presentation. DOM measurements confirmed 30px rows, 14px titles, no conversation-row kebab elements, and one project toolbar. At 880 × 560, document width stayed 880px. No fixture runtime errors were collected. These checks do not verify persistence through the real desktop backend.

Local screenshots: `release/qa/sidebar-refined-dark.jpg`, `sidebar-refined-hover.jpg`, `sidebar-refined-narrow.jpg`. The Windows directory preview was rebuilt after these source changes using the command above.

Grok Bot transport research is recorded separately in [GROK_BOT_INTEGRATION.md](GROK_BOT_INTEGRATION.md).

## Local installed update / 本机安装更新

At the user's request on 2026-10-01, a new NSIS installer was built in `release/local-ui-update/` with the same renderer assets above. It was installed over `C:\Users\OguriJay\AppData\Local\Programs\grok-harness` for the current user, without publishing a release. The local WIP version remains 0.6.0.

The installer exited with code 0. SHA-256 of the installed `resources/app.asar` matches the new package and differs from the old installation. Before relaunch, `state.sqlite`, `Preferences` and `Local State` matched their pre-install SHA-256 values. The old installation and those profile files were backed up under `release/local-update-backup-20261001-113402/`. The app was relaunched from the installed path, and its main and renderer processes remained running. This verifies installation and process startup; native UI interaction and real prompt execution still require separate verification.
