# Desktop platform: should ContextSpace stay on Electron?

Decision aid for the team. The desktop app is an Electron shell (`desktop/main.js`)
that starts the bundled Node backend on an OS-assigned local port and loads the
dashboard in a `BrowserWindow`. A plain browser remains a fully functional way
to access the same dashboard; only native desktop update install/restart is
desktop-only, and browser users receive a release-page link instead.

## What makes this app's shape unusual

Most "should we use Tauri instead?" comparisons assume the app logic can move into
the shell's native side. Ours cannot, cheaply:

- The backend **is a Node application** (Hono server, the whole `src/` CLI codebase).
- The chat feature **spawns local CLI processes** (`claude`, `agy`) and manages them.
- The GUI is served over localhost HTTP and also works in a plain browser
  (`ctxspace dashboard`), so the desktop shell is deliberately thin.

Any non-Electron shell still has to run that Node backend somehow.

## Comparison

| | Electron (current) | Tauri v2 | Neutralino (previous) | Wails v2/v3 |
|---|---|---|---|---|
| Shell runtime | Bundles Chromium + Node | Rust binary + OS webview (WebView2/WebKit) | Tiny binary + OS webview | Go binary + OS webview |
| Installer size | ~80–120 MB | ~3–10 MB shell, **but** + Node sidecar (~40–80 MB) for our backend | ~2 MB shell + same Node problem | ~8–15 MB + same Node problem |
| Memory | ~150–300 MB | Lower (shared OS webview) | Lower | Lower |
| Runs our Node backend | Natively (it *is* Node) | As a bundled **sidecar binary** (pkg/SEA/Bun-compiled `ctxspace`) — extra build pipeline | Same sidecar problem (we already left it) | Same sidecar problem, or rewrite server in Go |
| Extra toolchain | None (npm only) | Rust + platform build deps | None | Go |
| Webview consistency | Identical Chromium everywhere | WebView2 on Windows is fine; WebKit on macOS/Linux differs (CSS/JS quirks) | Same webview caveats + small ecosystem | Same webview caveats |
| Process spawning (claude/agy CLIs) | Backend does it today, unchanged | Allowed via sidecar/shell API, more permission plumbing | Limited APIs (a reason the old shell stayed thin) | Fine from Go, but our spawning code is TS |
| Packaging/auto-update maturity | electron-builder (NSIS/AppImage) + electron-updater — very mature | Good and improving | Weak | Decent |
| Migration effort from today | — | Rewrite shell in Rust config + build Node sidecar pipeline; GUI/backend unchanged | Already migrated away | Shell rewrite + sidecar pipeline |

## Packaging

The desktop app packages as standalone installers via electron-builder:

- `npm run prepare-backend` (in `desktop/`) builds the CLI, copies `dist/` and
  the manifests into `desktop/backend/`, and installs production-only deps
  there. The staged `backend/` runs the whole server standalone (verified:
  `node backend/dist/desktop-server.js` serves both the API and the built GUI).
- `desktop/package.json` `build` config ships `backend/` as an
  `extraResources` folder, so it lands at `resources/backend/` in the packaged
  app.
- At runtime `main.js` branches on `app.isPackaged`: in dev it runs
  `../dist/desktop-server.js` with `node`; when packaged it runs
  `resources/backend/dist/desktop-server.js` using Electron's own binary as Node
  (`ELECTRON_RUN_AS_NODE=1`), so **no separate Node runtime has to ship**.
- `npm run pack` produces an unpacked app (`--dir`); `npm run build` produces
  the installer with publishing disabled for local builds.
- Windows releases ship `NexusFlowSetup.exe` (NSIS) and `latest.yml`.
- Linux releases ship `NexusFlow-<version>.AppImage` and `latest-linux.yml`.
  Both installers have a required `.sha256` sidecar in the GitHub Release.
- Packaged Windows/Linux builds configure `electron-updater` with the GitHub
  provider. It checks on startup but does not download or install until the
  user chooses **Download update** and **Restart & Install**. `Later` and
  error/retry states are supported; there are no forced updates.
- The explicit CLI bootstrap, `nexusflow desktop install`, selects the matching
  Windows/Linux release asset, requires and verifies its checksum sidecar, then
  launches the Windows installer or copies the Linux AppImage to
  `~/.local/share/nexusflow/` and creates `~/.local/share/applications/nexusflow.desktop`.

Build-host note: `electron-builder` unpacks a code-signing toolchain that
contains symlinks, so the packaging step must run on a host with symlink
privilege — Linux/macOS CI, or Windows with Developer Mode (or admin) enabled.
On a stock non-elevated Windows account it fails while extracting that cache.
The backend bundle and runtime wiring are complete and verified; only the
installer-producing step depends on that host capability.

`main.js` also fails loudly (a visible error page) rather than showing a blank
window if the backend can't start.

## Recommendation

**Stay on Electron.** The usual Tauri wins (binary size, memory) mostly evaporate
here because the Node backend must ship regardless — either inside Electron (free)
or as a compiled sidecar (a new build pipeline, signing complications, and a second
runtime to debug). The current shell is 60 lines; the maintenance cost of Electron
for us is one dependency bump per quarter.

Revisit if any of these become true:

1. Users complain concretely about installer size or idle memory.
2. The backend gets rewritten off Node (then Tauri's sidecar penalty disappears).
3. The shell grows real native-side features (tray, global shortcuts, deep OS
   integration) where Tauri's Rust APIs would pull their weight.

If a migration is ever attempted, Tauri v2 is the candidate — prototype by keeping
the exact same `ui --port=0` backend as a sidecar and pointing the Tauri window at
the detected localhost URL; the GUI needs no changes.
