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
Cursor can start here, but its history is not yet indexed; use its native
picker. Cursor detection prefers `agent`, with `cursor-agent` as fallback.
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
| Pi | `pi --session ID` | [`pi --resume`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md) |

Hiding, minimizing, maximizing, and switching sessions keep the terminal
running. A browser reload reconnects to the same backend process. Closing a
session or losing its connection starts a five-minute reconnect grace
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

A tool listed as available is **installed**: its executable was found on PATH.
ContextSpace does not read tool credentials; each harness checks its own sign-in.
A harness that exits with an error within 15 seconds of starting (measured by
the backend, so a later reload reports it the same way) is flagged: its output
explains why, and sign-in or setup can be finished in an external terminal.

A conversation started in a fresh terminal belongs to that terminal once its
harness records it. Resuming that conversation from Sessions or the overview
reattaches to the running process instead of starting a second one on the same
conversation. The link is made only when the match is one-to-one: exactly one
terminal of that harness in the conversation's directory, running or recently
exited, started before the conversation (allowing a few seconds of clock skew);
it belongs to the same browser, is still running and has received input; and no
other conversation of that harness there has started since. Otherwise resume
starts a new process as before. A terminal that has ended (its grace period
passed, or the backend restarted) is labeled **Ended** rather than offered for
**Reconnect**. It offers **Resume conversation** when its conversation was
linked, and **Continue a conversation** otherwise.

## Switching between sessions

Open workspaces are listed in the sidebar under **Open sessions**, in the order they were opened. Choosing one never
reorders the list, and the one on screen is always marked. Close a session with its cross, or with Delete while it has
focus. The collapsed sidebar shows the same sessions as their initials. A dot beside a session means its terminal
stopped, lost its connection, or printed something while you were elsewhere.

| Keys | Does |
| --- | --- |
| Alt+Up, Alt+Down (Option on a Mac) | Go to the previous or next session, wrapping round |
| Alt+1 to Alt+9 | Go to that session |

Both keep the part of the workspace you are reading, such as the plan or the changes. The terminal keeps every other key,
including Alt+Left and Alt+Right for moving by word. A key the app has nothing to do with also reaches the CLI: Alt+Down
when only one session is open, or Alt+4 when there are three.

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
