# NexusFlow — Developer & Agent Specification

NexusFlow is a multi-repo workspace manager for AI-assisted development that creates isolated git worktrees on clean feature branches or manages in-place repositories, generating cohesive context files for AI coding assistants.

---

## ⌨️ Vim Navigation Mode Specification

### Design Principles
- **Modes like Vim**: `NORMAL` (navigation, cycling tabs, and quick actions), `INSERT` (typing in fields — full native pass-through except `Esc`), and `COMMAND` (`:` cmdline prompt).
- **Never fight the user**: Keystrokes are intercepted only outside editable fields and active dialog overlays. Mouse interaction remains fully functional. Native `Tab` behavior is untouched.
- **Discoverability**: Persistent statusline at the bottom of the screen indicating active mode, scope, and pending chords, paired with a visual keybinding cheatsheet (`?`).
- **Mirror CLI verbs**: `s` (start), `S` (stop), `L` (logs), `o` (open), `d` (diff), `c` (commit), `r` (sync), `f` (refresh) align directly with `nexusflow start|stop|logs|diff|commit|sync|refresh`.

### Keymap Reference

| Key | Action | Description |
|:---|:---|:---|
| `j` / `k` (with count, e.g. `3j`) | next / previous item | Move focus between items in the active view |
| `h` / `l` | previous / next tab | Switch to previous / next view or workspace subtab |
| `gg` / `G` | first / last item | Jump to first / last item in active scope |
| `gt` / `gT` / `g1`–`g9` | cycle / jump to tab | Cycle tabs or jump directly to tab index 1–9 |
| `Enter` / `Space` | activate focused item | Activate / click the focused element |
| `i` | focus search/filter | Focus nearest search or filter input (`INSERT` mode) |
| `Esc` | normal mode / dismiss | Leave `INSERT` mode, clear pending chords, close modals |
| `:` | command line prompt | Open command line (`:help :start :stop :logs :diff :commit :sync :refresh :doctor :tab <name> :w :q`) |
| `s` `S` `L` `o` `d` `c` `r` `f` | workspace actions | Quick actions: start, stop, logs, open, diff, commit, sync, refresh |
| `Ctrl+d` / `Ctrl+u` | half-page scroll | Smoothly scroll half page down / up |
| `?` | keybinding cheatsheet | Toggle keybinding cheatsheet overlay |
| `\` | toggle vim mode | Toggle Vim navigation mode on / off globally |

---

## 🏗️ Architecture & Conventions

- **Frontend**: React 19 + Vite 8 in `gui/`.
- **Backend API**: Local Hono server on port 3000 in `src/server.ts`.
- **State Management**: React Query (`@tanstack/react-query`) with synchronous route normalization.
- **Data Attributes for Vim Navigation**:
  - `data-vim-scope="<name>"`: Identifies the active navigational scope (e.g. `overview`, `changes`, `services`, `settings`).
  - `data-vim-item`: Identifies navigable rows, cards, or list entries.
  - `data-vim-action="<action>"`: Tags buttons for quick action triggers (`start`, `stop`, `logs`, `open`, `diff`, `commit`, `sync`, `refresh`).
  - `data-vim-search`: Marks view search and filter inputs for `i` focus.
  - `data-vim-scroll`: Marks scrollable output regions (e.g. terminal log viewer, diff pre).
  - `data-vim-tab="<tab>"`: Marks tab buttons for tab-switching chords.

---

## 🧪 Testing Guidelines

- **E2E Tests**: Playwright in `gui/e2e/` using `fixtures.ts` for mocked data. Run with `npm run test:e2e` in `gui/`.
- **Backend Unit Tests**: Vitest in `src/`. Run with `npm test` at the repository root.
- **Build Verification**: Run `npm run build` at root and in `gui/`.
