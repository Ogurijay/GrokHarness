# Desktop UI reference / 桌面界面参考

Source verified on 2026-10-01: locally installed official Codex App **26.928.2636.0**.
Read-only reference: `C:\Program Files\WindowsApps\OpenAI.Codex_26.928.2636.0_x64__2p2nqsd0c76g0\app\resources\app.asar`.
No app bundle was modified or copied into this repository.

`openai/codex` exposes the CLI, TUI and app-server, not the complete desktop React/CSS implementation:
https://github.com/openai/codex

## Verified parameters

From `webview/assets/app-shared-342447930c78.css`:

| Parameter | Official value | Harness mapping |
| --- | --- | --- |
| spacing | .25rem / 4px | `--space: 4px` |
| text-xs / sm / base / lg | 11 / 12 / 14 / 16px | labels / metadata / UI / headings |
| radius-sm / md / lg / xl | .375 / .5 / .625 / .75rem | 6 / 8 / 10 / 12px |
| radius-form-dialog | spacing × 6 | 24px |
| height-titlebar | spacing × 11 | 44px |
| height-toolbar | 46px | 46px |
| navigation row | 30px and 36px variants | 36px main navigation |
| foreground | light #1a1c1f; dark gray-fixed-150 (#dfdfdf) | `--text` |
| app surface | light #fff; dark gray-fixed-900 (#181818) | `--bg-main` |
| elevated opaque | light #fff; dark gray-fixed-750 (#282828) | `--bg-raised` |
| secondary gray surface | light #f9f9f9; dark #131313 | `--bg-sidebar` adaptation |
| border | foreground 8%; dark white 8% | `--line` |
| heavy border | foreground 12%; dark white 16% | `--line-heavy` |
| font | system / Segoe UI | system font plus Chinese fallback |
| basic transition | .15s ease | 150ms |

The CSS includes thread width utilities of 42rem and 48rem, but does not establish one universal desktop width. Harness uses **48rem** as its chosen reading width. Sidebar width **260px**, collapsed rail **52px**, inspector **320px**, media grid, search, categories and icon mappings are Harness adaptations, not verified Codex defaults.

The installed Electron version does not support all current Codex corner-shape behavior. Use the verified base radii without importing the conditional superellipse scaling. Tokens are implemented independently; proprietary components, icons, fonts and application code are not vendored.

## Scope / 范围

Phase 1: native titlebar integration, sidebar navigation and search, theme preferences, reusable composer, chat typography and activity surfaces.
Phase 2: categorized settings, account status, common accessible dialogs, usage and update surfaces, media library and preview styling.

Grok TUI theme settings remain separate from desktop appearance. Desktop preferences store only theme, text size and sidebar width in renderer local storage. No credentials are stored there.
ACP, existing session data, official CLI login, tray lifecycle and both updater paths retain their existing behavior. Full Git review, terminal and file editor are outside this iteration.
