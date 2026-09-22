# Embedded CLI sessions

Open Workspace Chat, select a workspace, choose **CLI**, select an installed
harness or **Shell**, then **Start session**. The maximize button fills the app.
**Chat** retains the existing structured chat providers and conversation history.
Switching modes does not stop an already opened chat or terminal.

The CLI runs with your local user permissions, in the selected workspace. Its own
authentication and permission prompts apply. ContextSpace does not install a
harness or bypass its approvals. Codex, Claude Code, Antigravity (agy), GitHub
Copilot, Cursor Agent, and Pi are launch targets. Pi is optional and uses the
same terminal transport. Choose a harness explicitly; workspace instruction
choices do not set a default. Tool logos always accompany their names.

**Resume session** inside the window reads the same histories as the workspace
Sessions tab. Choosing a conversation selects its recorded harness automatically.
Codex, Claude, AGY, and Copilot resume after verifying the provider record and its
canonical directory inside the workspace. A fuzzy display match alone cannot
authorize resume. Missing metadata offers the harness's own session picker.
Cursor and Pi can start here, but their histories are not yet indexed; use their
native picker. Cursor detection prefers `agent`, with `cursor-agent` as fallback.
Existing context files are available from the workspace directory; no kickoff
prompt is submitted automatically.

The **main thread** is your conversation; subagents carry out delegated tasks and
report back to it. Both history views hide confirmed subagents by default.
**Include subagent sessions** reveals them for inspection. A **Main thread**
button follows recorded parent links within the same harness. It is disabled if
the parent is absent; delegated sessions cannot launch through the resume API.
Codex classification uses `session_meta.source.subagent`, and Claude uses
`isSidechain` or legacy `agent-` filenames. User-created Codex forks remain main
threads. Histories with no reliable classification, including current AGY and
Copilot records, are labeled **Conversation** and remain visible. Titles are
never used to guess whether a session is a subagent.

Both lists show **Last activity** with date and local time, separately from
**Started**. The tooltip includes the full timestamp and local timezone. Latest
activity means the most recent valid provider record (including tool/events),
not necessarily the last conversational message. Codex and Claude use their
record timestamps, AGY includes history and available transcript timestamps,
and Copilot uses its stored update time. Out-of-order records cannot move the
latest activity backwards. Missing or invalid dates display **Last activity
unknown**; scanning the history never makes an old session appear newly active.

Resume command references, checked September 2026:

| Harness | Exact resume | Native picker / source |
| --- | --- | --- |
| Codex | `codex resume ID` | [`codex resume`](https://learn.chatgpt.com/docs/codex/cli) |
| Claude Code | `claude --resume ID` | [`claude --resume`](https://code.claude.com/docs/en/cli-reference) |
| Antigravity | `agy --conversation ID` | [`/resume`](https://antigravity.google/docs/cli/commands/resume) |
| GitHub Copilot | `copilot --resume ID` | [`copilot --resume`](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/chronicle) |
| Cursor Agent | Native picker for unindexed history | [`agent ls`](https://cursor.com/docs/cli/overview) |
| Pi | Native picker for unindexed history | [`pi --resume`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md) |

Hiding, minimizing, maximizing, and switching workspace tabs keep the terminal
running. A browser reload reconnects to the same backend process. Closing a
workspace tab or losing its connection starts a five-minute reconnect grace
period; after that the terminal is stopped. **End session** stops the process
and its current descendants. Quitting or restarting the backend ends terminals.
These are live sessions, not a daemon that survives app restarts.

Only one window can write to a terminal at a time. **Reconnect** reattaches after
a lost connection; keystrokes are not queued while disconnected. Output replay
is bounded in memory and may be partial after a large amount of output. Raw
terminal input/output is not written to a ContextSpace transcript. Harnesses may
store their own histories. Search, selection copy, and a screen-reader option
are available in the terminal footer. **External terminal** is an explicit
fallback; failed embedded launches never silently open another app.

## Development and verification

The renderer uses xterm.js 6 with fit/search addons. The backend uses node-pty
1.1, loaded lazily so other CLI commands still work without its native module.
Desktop packaging requires that module and runs a real shell under the packaged
Electron runtime in `afterPack`. An unavailable native module is reported in the
pane with a recovery message.

For GUI development, run the backend on port 3000 and Vite normally. A dedicated
Vite proxy keeps terminal HTTP and WebSocket requests on the page's origin.
The local transport checks exact origin, a browser-owner cookie and short-lived
token, workspace containment, and single-writer ownership.

Run from the repository root:

```sh
npm run build
npm test
node dist/terminal/smoke.js
npm run test:gui
npx --prefix gui playwright test --config gui/playwright.terminal.config.ts
npm run pack --prefix desktop
```

The live browser test uses an isolated configuration and real shell, without a
model account. CI runs the native smoke and browser tests on Windows, macOS,
and Linux. Packaging verifies the native module under Electron on each OS.
Local implementation evidence covers Linux x64 only; Windows ConPTY and macOS
still require their CI runs and interactive harness acceptance before release.
WSL bridging, remote hosts, daemon persistence, and ARM64 Windows/Linux are
outside this first implementation.
