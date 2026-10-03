# Windows desktop distribution

## Local build

```sh
npm ci
npm run build:win
```

Outputs in `release/`: NSIS installer, installer blockmap, `latest.yml`, and `win-unpacked/` for runtime testing. Install for the current user; no administrator permission or Node.js runtime is required. The official Grok CLI is a separate prerequisite. Selected CLI paths live in the app's user-data `desktop-preferences.json`; credentials remain managed by the official CLI in `~/.grok` (or `GROK_HOME`).

## Release

1. Verify type checks, packaged startup, missing-prerequisite flow, single instance, tray exit, and the installed application.
2. Follow `AGENTS.md` version and bilingual changelog rules; tag `vX.Y.Z`.
3. Publish the generated installer, `.blockmap`, and `latest.yml` together on the matching GitHub release. Never hand-edit hashes or version metadata.
4. Verify a previous installed version discovers and downloads the release, and restart installs it without losing user data. Do not claim this verification from a local build alone.

No release is published by `build:win` (`--publish never`). The updater only offers stable releases with Windows assets. Source-only releases remain visible via the release page but cannot be downloaded as app updates. In development, update discovery is available but installation is disabled.

## Signing and lifecycle

Current builds are unsigned and Windows may warn about an unknown publisher. Code-signing certificates and secrets must come from a secure build environment, never the repository. When signing is configured, enable updater signature verification and validate the publisher before distributing publicly.

Window close hides to the tray. Tray Quit stops the app-owned Grok process before exiting; unrelated CLI instances are not targeted. App update installation is blocked during an active prompt, then performs the same cleanup before restart. A second launch restores the existing window instead of creating another backend.

## Runtime verification

`npm run test:desktop` checks stable version ordering, release assets, and credential-presence formats (Node.js 22.18+). `npm run test:desktop:smoke` uses Playwright's Electron driver; install Playwright locally or set `PLAYWRIGHT_MODULE` to an available package directory. It launches the packaged executable with separate temporary `--user-data-dir` profiles, tests missing-CLI and existing-account flows, SQLite initialization, compact and standard layouts, single-instance restoration, and app-owned backend shutdown. Screenshots stay in ignored `release/qa/`.

Set `DESKTOP_EXECUTABLE` to an installed executable to run the same checks against the actual installation. Existing credentials are only read for the ready-state check. This does not send a model prompt or exercise browser login, media generation, or a cross-version GitHub upgrade.

Set `GROK_TEST_BINARY` to the official executable when running `test:desktop` to additionally test cancellation of an in-flight backend start. Without it, that integration case is skipped.
