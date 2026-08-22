<p align="center">
  <h1 align="center">🔗 NexusFlow</h1>
  <p align="center">
    <strong>Multi-repo workspace manager for AI-assisted development</strong>
  </p>
  <p align="center">
    Group repositories · Generate AI context · Resume LLM sessions · Orchestrate services
  </p>
</p>

---

NexusFlow combines multiple Git repositories into a single feature workspace and generates the context files that your AI coding assistant needs to understand all of them at once. It can create isolated **git worktrees** on clean feature branches, or work in-place directly in your source repositories when you want to manage branches yourself.

> **New to NexusFlow?** Jump to the [Getting Started Guide](GETTING_STARTED.md) for a hands-on walkthrough.

## ✨ Features

- **Multi-repo workspaces** — group any set of local Git repos in isolated worktrees or in-place source repositories
- **Project registry** — save named, persistent repo groups in `~/.nexusflow/projects.json` and reuse them from the CLI or API
- **The full feature loop** — `create` opens a workspace, `finish` closes it: commit + push every repo, open PRs (or print compare links), promote learnings, and optionally clean up
- **Knowledge that accumulates** — capture decisions and gotchas as you work with `nexusflow knowledge add`, then `promote` the reusable ones into per-repo memory that survives across features
- **AI context generation** — automatically writes `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, and `.cursor/rules/nexusflow.mdc`
- **Drive it from your assistant** — an MCP server exposes the whole loop (status, diff, commit, sync, refresh, doctor, knowledge, finish) so your AI can run it without leaving the session
- **Smart codebase analysis** — detects tech stacks, ports, API endpoints, dependencies, and existing AI configs across all projects
- **Resource Library** — create and administer reusable Agent Skill folders and Codex-native custom agents, then assign them to workspaces
- **Owned Resource Deployment** — installs portable skills to native discovery folders and Codex agents to `.codex/agents/`, refusing unmanaged collisions and preserving locally modified files
- **Teamwork Strategy Workflows** — predefine coordination flows and subagent behaviors (e.g. plan-implement-review) and inspect them with local AI coding assistant harnesses
- **Session history & resumption** — browse past conversation transcripts from Antigravity, Claude Code, OpenAI Codex, and GitHub Copilot, then resume where you left off

- **Incremental, token-efficient refresh** — an analysis cache fingerprints each repo (HEAD + dirty files), so `refresh`/`sync` only re-analyze repos that changed and unchanged maps stay byte-identical (keeping your AI assistant's prompt cache warm)
- **Scheduled workspace jobs** — recurring `sync`/`refresh` per workspace (e.g. every 2h) that run while the dashboard server is up, so context files stay fresh without manual runs
- **Service orchestration** — start, stop, and tail logs for all services in a workspace with a single command
- **Interactive Web Dashboard** — rich dark-themed GUI for managing workspaces, viewing sessions, and streaming logs
- **CLI-first** — every action available from the terminal via the `nexusflow` command

## 📦 Installation

### Prerequisites

| Requirement | Version | Platform Notes |
|:---|:---|:---|
| [Node.js](https://nodejs.org) | 20 or later | Supported across Linux, macOS, and Windows |
| [Git](https://git-scm.com) | 2.20 or later | Required for worktree and multi-git operations |
| npm | Bundled with Node.js | Standard package manager |
| `xdg-utils` | Recommended | Linux only (for auto-opening browser/editors) |

### Install from npm

```bash
npm install -g @mrpatronz/nexusflow
```

### Install from source

```bash
git clone https://github.com/antan87/NexusFlow.git
cd NexusFlow

# Install backend dependencies
npm install

# Install GUI dependencies
cd gui && npm install && cd ..

# Build everything
npm run build

# Link the CLI globally
npm link
```

After linking, the `nexusflow` command is available system-wide.

## 🚀 Quick Start

```bash
# 1 — Initialize config (optional, defaults work out of the box)
nexusflow init

# 2 — Create a feature workspace
nexusflow create

# 3 — Or use the GUI: desktop app (see desktop/) or browser dashboard
nexusflow dashboard
```

The `create` wizard walks you through:

1. **Choose a repo source** — start from a registered project or scan/pick ad-hoc repos
2. **Choose a work mode** — isolated worktrees or in-place source repositories
3. **Name the branch or workspace** — branch name for worktrees, workspace name for in-place
4. **Describe what you're building** — plain text or a path to a `.md` file
5. **Choose AI assistant(s)** — auto-detects what's installed
6. **Done!** — workspace created with AI context files, plus git worktrees in isolated mode

## 📚 Projects

A project is a named, persistent group of source repositories stored centrally in `~/.nexusflow/projects.json`. Project ids are slugified from the name, so `Hogia Billing` becomes `hogia-billing`. Use either the `project` command group or its `proj` alias:

| Command | Description |
|:---|:---|
| `nexusflow project add -n, --name <name> -r, --repos <paths...> [-d, --description <text>]` | Register a project; omit `--repos` to use the interactive repo picker |
| `nexusflow project list` | List registered projects (alias: `ls`) |
| `nexusflow project show [id]` | Show a registered project |
| `nexusflow project remove [id] [-y, --yes]` | Remove a project from the registry (alias: `rm`) |

Removing a project only edits the registry — it never deletes repositories or workspaces on disk. The HTTP API exposes the same registry through `GET /api/projects`, `POST /api/projects`, `PUT /api/projects/:id`, and `DELETE /api/projects/:id`.

## 🧭 Work Modes

`nexusflow create` offers registered projects first (ad-hoc repo scanning is still available), then asks how the workspace should work:

| Mode | What it does |
|:---|:---|
| **Isolated worktrees** | The classic flow: NexusFlow creates a feature branch and git worktree per repo inside the workspace directory. |
| **In-place** | NexusFlow works directly in the source repositories. No branches or worktrees are created; you provide a workspace name, and the workspace directory only holds `nexusflow.json` plus generated AI context files. |

In in-place workspaces, `nexusflow sync` is a deliberate no-op because you manage branches yourself. `nexusflow finish` commits and pushes each repo's current branch, and only offers PR/compare links when that branch differs from the default branch. Deleting an in-place workspace never touches the source repositories, `nexusflow list` tags it with `[in-place]`, and agent sessions for single-repo in-place workspaces run in the repo root.

For API callers, `POST /api/workspace` accepts optional `mode` (`worktree` default, or `in-place`), `name` (required for in-place), and `projectId`. Existing workspace manifests without a `mode` field are treated as `worktree` mode.

## 📂 What Gets Generated

In isolated worktree mode:

```
~/dev/workspaces/feature/user-auth/
├── CLAUDE.md                         # Context for Claude Code
├── AGENTS.md                         # Canonical context for Antigravity, Codex & agents
├── .agents/
│   └── skills/                       # Skills for Google Antigravity (SKILL.md + assets)
├── .claude/
│   └── skills/                       # Skills for Claude Code (SKILL.md + assets)
├── .codex/
│   └── skills/                       # Skills for OpenAI Codex (SKILL.md + assets)
├── .github/
│   ├── copilot-instructions.md       # Context for GitHub Copilot
│   └── instructions/                 # Scoped skill instructions for Copilot
├── .cursor/
│   └── rules/                        # Context & rules for Cursor (.mdc)
├── nexusflow.json                    # Feature config (branch, repos, etc.)
├── nexusflow-overview.md             # AI-generated workspace analysis
├── nexusflow-knowledge.md            # Persistent workspace memory (decisions & gotchas)
├── my-api/                           # ← Git worktree on feature branch
└── my-frontend/                      # ← Git worktree on feature branch
```

In-place workspaces keep the manifest, skills, and generated AI context files in the workspace directory while the code stays in the source repositories.

Open this folder in your editor → your AI assistant picks up the context and skills → it understands *all* your repos.

## 🖥️ Commands

| Command | Description |
|:---|:---|
| `nexusflow create` | Interactive wizard to create a new worktree or in-place workspace |
| `nexusflow list` | List all existing workspaces, tagging in-place ones with `[in-place]` (alias: `ls`) |
| `nexusflow open` | Re-open a workspace in your editor |
| `nexusflow init` | Configure NexusFlow settings |
| `nexusflow project` | Manage registered repo groups: `add`, `list`/`ls`, `show`, `remove`/`rm` (alias: `proj`) |
| `nexusflow add-repo` | Add a repository to an existing workspace (alias: `add`) |
| `nexusflow remove` | Delete a workspace and prune its git worktrees when present (alias: `rm`) |
| `nexusflow start` | Start all services in a workspace (auto-detected) |
| `nexusflow stop` | Stop all running services |
| `nexusflow status` | Show running/stopped status and PIDs |
| `nexusflow logs` | Tail aggregated logs from all services |
| `nexusflow ui` | Start the dashboard server — the backend the desktop app embeds (`--port`, `--open`, `--strict-port`) |
| `nexusflow dashboard` | Open the dashboard in your browser (alias: `dash`) |
| `nexusflow tui` | Open the interactive terminal (TUI) dashboard |
| `nexusflow diff` | View changes across all sub-repositories, including unpushed commits (`--repo` to filter) |
| `nexusflow commit` | Commit and push changes across all modified repositories (`--repo`, `--no-push`, `--dry-run`) |
| `nexusflow sync` | Rebase worktree-mode repositories with default base branches; deliberate no-op for in-place workspaces |
| `nexusflow finish` | Close out a feature: commit & push all repos, open PRs / print compare links, promote learnings, optionally remove the workspace (`-m`, `--no-pr`, `--no-knowledge`, `--cleanup`, `--dry-run`) |
| `nexusflow review` | Start an iterative reviewer-implementer agent loop with automated verification harnesses |
| `nexusflow knowledge` | Capture & manage workspace learnings: `add` (decision/gotcha/progress/…), `show`, `promote` into per-repo base knowledge |
| `nexusflow refresh`| Regenerate maps, plan, and AI context files — only re-analyzes changed repos (`--force` for a full pass) |
| `nexusflow handoff` | Generate a compact handoff bundle (`nexusflow-handoff.md`) for session resumption |
| `nexusflow schedule` | Manage recurring workspace jobs: `add`, `list`, `remove`, `enable`, `disable`, `run` |
| `nexusflow doctor` | Run health checks and diagnostics to verify workspace integrity |
| `nexusflow config` | View and update configuration: `show`, `get <key>`, `set <key> <value>` |
| `nexusflow adapter` | Manage storage adapters: `list`, `use`, `info`, `init` |
| `nexusflow mcp` | Manage the MCP server for AI assistants: `run`, `setup` |
| `nexusflow desktop` | Launch the Electron desktop app from the workspace `desktop/` project (requires a built CLI and `desktop/` deps installed) |

## 🤖 Supported AI Assistants

NexusFlow auto-detects which assistants are available on your machine and generates the right context files and skills for each:

| Assistant | Config File & Skills Target | How It's Detected |
|:---|:---|:---|
| **Google Antigravity** | `AGENTS.md` & `.agents/skills/` | `antigravity` in PATH |
| **Claude Code** | `CLAUDE.md` & `.claude/skills/` | `claude` in PATH |
| **OpenAI Codex** | `AGENTS.md`, `.agents/skills/` & `.codex/agents/` | `codex` in PATH |
| **GitHub Copilot** | `.github/copilot-instructions.md` & `.agents/skills/` | Always available |
| **Cursor** | `.cursor/rules/nexusflow.mdc` & `.agents/skills/` | `cursor` in PATH |


## 🔁 The Feature Loop: create → work → learn → finish

NexusFlow is built around a single loop:

1. **`nexusflow create`** — open a worktree or in-place workspace with AI context files generated. Along the way you can **scaffold a brand-new project** (a fresh local git repo in your dev directory) and, per repo, **check out an existing branch** — local or remote — instead of creating the feature branch.
2. **Work** — your AI assistant edits code across repos. As it goes, it records learnings:
   ```bash
   nexusflow knowledge add -t decision -m "Chose worktrees over submodules for isolation"
   nexusflow knowledge add -t gotcha   -m "fs.rm needs maxRetries on Windows (EBUSY)"
   nexusflow knowledge add -t progress -m "Rollback-on-failure implemented"
   ```
   Entries land under the right heading in `nexusflow-knowledge.md` (routed through your storage adapter — local or central vault — so the GUI and the generators all see the same file). No hand-editing, no accidental overwrites.
3. **`nexusflow finish`** — close it out:
   - Shows a preflight status table (branch, dirty files, unpushed commits) per repo.
   - Commits any remaining changes and pushes every branch; worktree-mode repos on the wrong branch or in a detached HEAD are skipped, while in-place workspaces use each repo's current branch.
   - Opens a PR per repo with the GitHub CLI when it's installed and authenticated; otherwise prints a ready-to-click **compare URL** for GitHub, GitLab, Azure DevOps, or Bitbucket.
   - Offers to **promote** reusable learnings into each repo's persistent base knowledge (so they survive into the next feature).
   - With `--cleanup`, removes the workspace once everything is confirmed pushed (never while you're `cd`'d inside it, and never touching source repositories for in-place workspaces).

   ```bash
   nexusflow finish --dry-run        # preview what would happen
   nexusflow finish -m "Ship feature" --cleanup
   ```

## 🔌 MCP Server & Tools

`nexusflow mcp setup` registers NexusFlow's MCP server with Claude Desktop, Cursor, and VS Code so your assistant can drive the whole loop without leaving the session. The server exposes:

| Tool | What it does |
|:---|:---|
| `search_workspace` | `git grep` across every repo in the workspace |
| `workspace_status` | Per-repo branch / dirty / ahead-behind / remote status |
| `get_workspace_diff` | Changed files, insertions/deletions, and unpushed commits |
| `commit_workspace` | Commit (and push) all changed repos with one message |
| `sync_workspace` | Rebase every repo onto its base branch (auto-stashes dirty trees) |
| `refresh_context` | Regenerate maps/plan/context (only re-analyzes changed repos) |
| `run_doctor` | Structured workspace health diagnostics |
| `add_knowledge` | Record a decision / gotcha / progress note — the preferred way to persist learnings |
| `promote_knowledge` | Copy a learning into a repo's persistent base knowledge |
| `finish_workspace` | Commit, push, and return PR/compare links (never deletes anything) |
| `get_service_logs` | Tail a running service's logs |


Read-only tools are annotated as such; `finish_workspace` deliberately cannot delete worktrees (cleanup stays a human-confirmed CLI action). Pass `--debug` (or set `NEXUSFLOW_DEBUG=1`) on any CLI command to surface diagnostic logging on stderr.

## 🕐 Session History & Resumption

NexusFlow can discover and display your past AI coding sessions across all supported assistants. This lets you:

- **Browse** conversation transcripts from previous sessions
- **Search** through your interaction history
- **Resume** a session by copying the resume command to your clipboard

Session data is read directly from each assistant's local storage:

| Assistant | Session Location |
|:---|:---|
| Antigravity | `~/.gemini/antigravity-cli/brain/` |
| Claude Code | `~/.claude/projects/` |
| OpenAI Codex | `~/.codex/sessions/` |
| GitHub Copilot | `~/.copilot/` |

Access sessions via the Web Dashboard's **Sessions** tab or through the API:

```
GET /api/workspace/:id/sessions
GET /api/session/:assistant/:sessionId/transcript
```

## 🗄️ Pluggable Storage & Vault Adapters

NexusFlow supports multiple storage backends to control where workspace context maps, plans, and persistent AI knowledge files are stored. This allows keeping your Git repository workspaces completely clean from AI file clutter.

Available storage providers:
- **Local (`local`)** — Stores files directly in the workspace directory (default).
- **Central Vault (`central-vault`)** — Stores files in a centralized folder on your machine at `~/.nexusflow/vault/`. The folder is plain markdown, so it can be opened as (or symlinked into) an Obsidian vault.

### CLI Adapter Management

Configure storage adapters from the command line:

```bash
# List all registered storage adapters and the active provider
nexusflow adapter list

# View configurations and fields for a specific adapter
nexusflow adapter info central-vault

# Switch to a different adapter (e.g. central-vault) and configure its settings
nexusflow adapter use central-vault

# Scaffolds a template for creating a new custom storage adapter plugin
nexusflow adapter init my-custom-plugin
```

## 🕐 Scheduled Workspace Jobs

Keep workspaces fresh without manual runs — schedule recurring `sync` or `refresh` jobs per workspace:

```bash
# Rebase + regenerate context every 2 hours
nexusflow schedule add --task sync --every 2h

# Nightly context refresh for a specific workspace
nexusflow schedule add ~/dev/workspaces/my-feature --task refresh --every 1d

# Inspect, pause, or run jobs
nexusflow schedule list
nexusflow schedule disable <id>
nexusflow schedule run <id>
```

Jobs are stored in `~/.nexusflow/schedules.json` and executed while a NexusFlow server is running — start one with `nexusflow ui` (use `--daemon` for a background host). A job whose interval elapsed while no server was running simply runs on the next scheduler tick.

Scheduled runs are **token-efficient by design**: they use the same analysis cache as `nexusflow refresh`, so only repos whose content changed are re-analyzed, and unchanged context files are left byte-identical (no git churn, no invalidated AI prompt caches). The dashboard API exposes the same functionality under `/api/schedules`.

## 🧩 Resource Library

NexusFlow provides separate libraries for portable Agent Skills and Codex-native custom agents. Skills are complete directories; agents are validated native TOML definitions rather than skills disguised as personas.

Skills bundle metadata triggers (for AI autonomous discovery) with full Markdown execution playbooks, auxiliary reference runbooks (`references/`), and automation scripts (`scripts/`).

### Category Boxes & Visual Drag-and-Drop

Skills are grouped into clear visual accordion boxes by category. You can drag and drop skill cards between category boxes to re-categorize them, or use the quick menu on touch and mobile devices.

#### Built-in Category Templates & Skills:
- 🔀 **Pull Requests & Review**: `pr-review-toolkit`, `pr-description-gen`, `merge-conflict-resolver`
- 🧪 **Testing & Quality Assurance**: `verifier-workspace`, `e2e-runner`, `unit-test-coverage`
- 📦 **Cross-Repo & Release Ordering**: `nexusflow-local-package-loop`, `nexusflow-release-ordering`
- 🗄️ **Database & Migrations**: `schema-migration-validator`, `sql-fluff-linter`
- 🛡️ **Security & Auditing**: `secret-scanner`, `security-auditor`

#### Custom Categories & Workspace Scoping
- **Custom Categories**: Users can create, customize (colors, icons, descriptions), or delete custom categories. Custom overrides to built-in templates can be deleted at any time to restore default values.
- **Workspace Scoping**: Switch the scope dropdown to a feature workspace, edit a local draft, and save the complete selection with an optimistic revision check. Refresh the workspace to reconcile the saved selection.

### Codex Agent Administration

The Codex Agent Library supports creating, editing, importing, and deleting basic native agents with `name`, `description`, and `developer_instructions`, plus optional model, reasoning, and sandbox defaults. Selected agents are installed at `.codex/agents/<name>.toml`. Provider-neutral agent translation, agent teams, and collaboration kits are intentionally outside this feature.

### Cross-Harness Deployment

When a workspace is refreshed, NexusFlow reconciles enabled resources through `.nexusflow/resources.lock.json`. It refuses unmanaged target collisions, removes only unchanged NexusFlow-owned outputs, and reports modified-file conflicts instead of overwriting them.

| Assistant Harness | Deployment Path | Format |
|:---|:---|:---|
| **Google Antigravity** | `.agents/skills/<name>/SKILL.md` | YAML frontmatter + Markdown body + `references/` + `scripts/` |
| **Claude Code** | `.claude/skills/<name>/SKILL.md` | YAML frontmatter + Markdown body + `references/` + `scripts/` |
| **OpenAI Codex** | `.agents/skills/<name>/SKILL.md` | Complete portable Agent Skill directory |
| **Cursor** | `.agents/skills/<name>/SKILL.md` | Complete portable Agent Skill directory |
| **GitHub Copilot** | `.agents/skills/<name>/SKILL.md` | Complete portable Agent Skill directory |

Codex custom agents are separate resources and deploy to `.codex/agents/<name>.toml`.

## 👥 Teamwork Strategy Workflows

NexusFlow allows you to predefine orchestration workflows and cooperation rules that govern how multiple AI subagents coordinate when solving complex, multi-repo software engineering tasks.

You can select a strategy workflow when creating a workspace (or define custom ones). Built-in templates include:
- **Plan-Implement-Review** — A structured, multi-agent flow where an Orchestrator coordinates planning, implementation, review, and documentation.
- **Research-Verify** — A fast iteration strategy centered on research, drafting code, and immediately running verification test suites.
- **Solo Developer** — A simplified, lightweight direct-action workflow for minor tweaks and linear tasks.

### Custom Strategies & AI Inspection

You can create, edit, or delete custom strategies directly via the Web Dashboard's **Team Strategies** tab. Strategies are written in clean Markdown guidelines and stored in:
`~/.nexusflow/workflows/`

The dashboard integrates an **AI Strategy Analysis** inspector:
1. Select an AI assistant harness installed on your machine (e.g. *Claude Code*, *Antigravity*).
2. (Optional) Provide a comment or specific evaluation focus (e.g. *"Ensure subagent roles are distinct"*).
3. Click **Inspect Strategy** to have the AI analyze the strategy rules, identify ambiguities/contradictions, rate its orchestration effectiveness, and generate an optimized rewritten guideline.

## 🖥️ Dashboard (Desktop App & Browser)

The primary GUI is the Electron desktop app in `desktop/` (`npm install && npm start` there). It embeds the same dashboard the browser sees. For browser access, run `nexusflow dashboard`; `nexusflow ui` starts the underlying server without opening anything (add `--open` to launch a browser). For the platform rationale (Electron vs Tauri and friends), see [docs/desktop-platform.md](docs/desktop-platform.md). The dashboard is a full-featured dark-themed GUI:

- **Workspaces tab** — create, browse, and manage feature workspaces
- **Skills & Agents tab** — manage reusable skills, categories, drag-and-drop boxes, and workspace skill assignments
- **Team Strategies tab** — inspect and author coordination workflows and multi-agent roles
- **Open with…** — launch the workspace directly in a detected Codex Desktop, Claude Desktop, VS Code, VS Code Insiders, Cursor, JetBrains IDE, or other supported editor; unavailable apps stay out of the primary picker
- **Chat tab** — use local CLI harnesses directly; Codex reuses `codex login` for workspace-write chat and GitHub Copilot reuses `copilot login` for read-only ACP chat, so NexusFlow does not need their API keys
- **Sessions tab** — view past AI conversation transcripts and resume sessions
- **Logs panel** — real-time aggregated service log output
- **Config panel** — edit NexusFlow settings from the browser


The deprecated `POST /api/open-editor` endpoint remains available to older GUI clients only for recognized graphical editors. Interactive terminal editors such as Vim, Neovim, Nano, and Emacs are not supported by that detached HTTP launch route because it cannot provide a TTY.

The dashboard runs a local [Hono](https://hono.dev) server on port 3000 and serves a [React](https://react.dev) + [Vite](https://vite.dev) frontend.

## ⚙️ Configuration

NexusFlow stores its config at `~/.nexusflow/config.json`:

```json
{
  "version": "0.1.0",
  "devDir": "~/dev",
  "workspacesDir": "~/dev/workspaces",
  "scanDepth": 2,
  "defaultAssistant": null
}
```

| Key | Default | Description |
|:---|:---|:---|
| `devDir` | `~/dev` | Root directory to scan for git repos |
| `workspacesDir` | `~/dev/workspaces` | Where feature workspaces are created |
| `scanDepth` | `2` | How many levels deep to scan for repos |
| `defaultAssistant` | `null` | Pre-select an assistant during workspace creation |

Run `nexusflow init` to interactively set these values.

## 🏗️ Architecture

```
NexusFlow/
├── src/
│   ├── index.ts              # CLI entry point (Commander.js)
│   ├── server.ts             # Hono API server (REST endpoints)
│   ├── types.ts              # Shared TypeScript interfaces
│   ├── commands/             # CLI command handlers
│   │   ├── create.ts         #   nexusflow create
│   │   ├── init.ts           #   nexusflow init
│   │   ├── list.ts           #   nexusflow list
│   │   ├── open.ts           #   nexusflow open
│   │   ├── start.ts          #   nexusflow start
│   │   ├── stop.ts           #   nexusflow stop
│   │   ├── status.ts         #   nexusflow status
│   │   ├── logs.ts           #   nexusflow logs
│   │   └── ui.ts             #   nexusflow ui
│   ├── core/                 # Core workspace logic
│   │   ├── config.ts         #   Config management (~/.nexusflow/)
│   │   ├── scanner.ts        #   Git repo scanner
│   │   ├── worktree.ts       #   Git worktree operations
│   │   └── workspace.ts      #   Workspace CRUD
│   ├── analyzers/            # Codebase analysis
│   │   ├── tech-stack.ts     #   Language/framework detection
│   │   ├── detect-ports.ts   #   Port & server detection
│   │   ├── detect-apis.ts    #   API endpoint scanning
│   │   ├── detect-deps.ts    #   Dependency analysis
│   │   ├── detect-existing.ts#   Existing AI config detection
│   │   └── readme-summarizer.ts# README content extraction
│   ├── generators/           # AI context file & skill generators
│   │   ├── base.ts           #   Shared context builder
│   │   ├── claude.ts         #   CLAUDE.md generator
│   │   ├── antigravity.ts    #   Antigravity AGENTS.md generator
│   │   ├── codex.ts          #   Codex AGENTS.md generator
│   │   ├── copilot.ts        #   copilot-instructions.md generator
│   │   ├── cursor.ts         #   nexusflow.mdc generator
│   │   └── skills-generator.ts # Cross-harness skill deployment (.agents, .claude, .cursor, .codex)
│   ├── orchestration/        # Service start/stop/log management
│   └── utils/                # Helper utilities
│       ├── skills-catalog.ts #   Skills & Categories catalog manager (~/.nexusflow/)
│       ├── git.ts            #   Git operations
│       ├── detect-ai.ts      #   AI assistant detection
│       ├── detect-editors.ts #   Editor detection
│       ├── session-finder.ts #   AI session history discovery
│       └── prompts.ts        #   Interactive prompts
├── gui/                      # React + Vite Web Dashboard
│   └── src/
│       ├── pages/
│       │   ├── WorkspacesPage.tsx # Workspaces & launch targets
│       │   ├── SkillsPage.tsx     # Skills & Agents categorized drag-and-drop hub
│       │   └── StrategiesPage.tsx # Teamwork strategy inspector
│       └── App.tsx           # Main application routing & layout
├── package.json
└── tsconfig.json
```


## 🤝 Contributing

Contributions are welcome! Here's how to get set up:

### Development Setup

```bash
# Clone the repo
git clone https://github.com/antan87/NexusFlow.git
cd NexusFlow

# Install all dependencies
npm install
cd gui && npm install && cd ..

# Start the TypeScript compiler in watch mode
npm run dev

# In another terminal, start the GUI dev server
cd gui && npm run dev
```

### Build

```bash
# Full build (TypeScript + GUI)
npm run build

# Clean build artifacts
npm run clean
```

### Test

```bash
# Run tests
npm test

# Watch mode
npm run test:watch
```

### Code Style

- **TypeScript** — strict mode, ES modules
- **Imports** — use `.js` extensions for local imports (`import { x } from './config.js'`)
- **Node built-ins** — use the `node:` prefix (`import path from 'node:path'`)
- **JSDoc** — add doc comments to all exported functions
- **Error handling** — wrap external calls (git, filesystem) in try/catch

### Adding a New AI Assistant

1. Add the assistant identifier to the `AIAssistant` type in [types.ts](src/types.ts)
2. Add detection logic in [detect-ai.ts](src/utils/detect-ai.ts)
3. Create a new generator in `src/generators/` (follow the pattern in [claude.ts](src/generators/claude.ts))
4. Register it in the [generator index](src/generators/index.ts)
5. Add session discovery logic in [session-finder.ts](src/utils/session-finder.ts)

### Adding a New Analyzer

1. Create a new file in `src/analyzers/` following the existing patterns
2. Export the analyzer function and register it in [analyzers/index.ts](src/analyzers/index.ts)
3. The analyzer output is fed into the context generators and the `WORKSPACE.md` file

### Pull Request Guidelines

- Fork the repo and create a feature branch
- Write clear commit messages
- Add tests for new functionality
- Make sure `npm run build` passes before submitting
- Update documentation if you change user-facing behavior

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
