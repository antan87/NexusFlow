# Desktop platform: should NexusFlow stay on Electron?

Decision aid for the team. Current state: the desktop app is a ~60-line Electron
shell (`desktop/main.js`) that spawns the Node backend (`dist/index.js ui --port=0`)
and loads the dashboard from `http://localhost:<port>` in a `BrowserWindow`.

## What makes this app's shape unusual

Most "should we use Tauri instead?" comparisons assume the app logic can move into
the shell's native side. Ours cannot, cheaply:

- The backend **is a Node application** (Hono server, the whole `src/` CLI codebase).
- The chat feature **spawns local CLI processes** (`claude`, `agy`) and manages them.
- The GUI is served over localhost HTTP and also works in a plain browser
  (`nexusflow dashboard`), so the desktop shell is deliberately thin.

Any non-Electron shell still has to run that Node backend somehow.

## Comparison

| | Electron (current) | Tauri v2 | Neutralino (previous) | Wails v2/v3 |
|---|---|---|---|---|
| Shell runtime | Bundles Chromium + Node | Rust binary + OS webview (WebView2/WebKit) | Tiny binary + OS webview | Go binary + OS webview |
| Installer size | ~80–120 MB | ~3–10 MB shell, **but** + Node sidecar (~40–80 MB) for our backend | ~2 MB shell + same Node problem | ~8–15 MB + same Node problem |
| Memory | ~150–300 MB | Lower (shared OS webview) | Lower | Lower |
| Runs our Node backend | Natively (it *is* Node) | As a bundled **sidecar binary** (pkg/SEA/Bun-compiled `nexusflow`) — extra build pipeline | Same sidecar problem (we already left it) | Same sidecar problem, or rewrite server in Go |
| Extra toolchain | None (npm only) | Rust + platform build deps | None | Go |
| Webview consistency | Identical Chromium everywhere | WebView2 on Windows is fine; WebKit on macOS/Linux differs (CSS/JS quirks) | Same webview caveats + small ecosystem | Same webview caveats |
| Process spawning (claude/agy CLIs) | Backend does it today, unchanged | Allowed via sidecar/shell API, more permission plumbing | Limited APIs (a reason the old shell stayed thin) | Fine from Go, but our spawning code is TS |
| Packaging/auto-update maturity | electron-builder / Squirrel — very mature (we use Inno Setup) | Good and improving | Weak | Decent |
| Migration effort from today | — | Rewrite shell in Rust config + build Node sidecar pipeline; GUI/backend unchanged | Already migrated away | Shell rewrite + sidecar pipeline |

## Known limitation: packaged builds need backend bundling

The current shell runs `node ../dist/index.js` from the source checkout with
`node` assumed on PATH. That works when running from the repo (`npm start`),
but a packaged/installed app has no `../dist` and may have no Node. Shipping a
real installer still requires: bundling `dist/` (electron-builder
`files`/`extraResources`) and either bundling a Node runtime or compiling the
backend to a single executable. `desktop/main.js` now fails loudly (a visible
error page) instead of showing a blank window when the backend can't start,
but the bundling work itself is open. Until then, "distribution" means running
from a built checkout.

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
