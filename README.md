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

NexusFlow combines multiple Git repositories into a single feature workspace and generates the context files that your AI coding assistant needs to understand all of them at once. It uses **git worktrees** so every repo stays on a clean feature branch without disturbing your main working copy.

> **New to NexusFlow?** Jump to the [Getting Started Guide](GETTING_STARTED.md) for a hands-on walkthrough.

## ✨ Features

- **Multi-repo workspaces** — group any set of local Git repos under one feature branch using worktrees
- **AI context generation** — automatically writes `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, and `.cursor/rules/nexusflow.mdc`
- **Codebase context packing** — compress an entire multi-repo workspace into a single token-efficient XML file for web-based LLMs using Repomix
- **Smart codebase analysis** — detects tech stacks, ports, API endpoints, dependencies, and existing AI configs across all projects
- **Teamwork Strategy Workflows** — predefine coordination flows and subagent behaviors (e.g. plan-implement-review) and inspect them with local AI coding assistant harnesses
- **Session history & resumption** — browse past conversation transcripts from Antigravity, Claude Code, OpenAI Codex, and GitHub Copilot, then resume where you left off
- **Service orchestration** — start, stop, and tail logs for all services in a workspace with a single command
- **Interactive Web Dashboard** — rich dark-themed GUI for managing workspaces, viewing sessions, and streaming logs
- **CLI-first** — every action available from the terminal via the `nexusflow` command

## 📦 Installation

### Prerequisites

| Requirement | Version |
|:---|:---|
| [Node.js](https://nodejs.org) | 18 or later |
| [Git](https://git-scm.com) | 2.20 or later (worktree support) |
| npm | Bundled with Node.js |

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

# 3 — Or launch the Web Dashboard
nexusflow ui
```

The `create` wizard walks you through:

1. **Name your feature branch** — e.g. `feature/user-auth`
2. **Describe what you're building** — plain text or a path to a `.md` file
3. **Pick your repos** — NexusFlow scans `~/dev` for git repositories
4. **Choose AI assistant(s)** — auto-detects what's installed
5. **Done!** — workspace created with git worktrees + AI context files

## 📂 What Gets Generated

```
~/dev/workspaces/feature/user-auth/
├── CLAUDE.md                         # Context for Claude / Antigravity
├── AGENTS.md                         # Context for OpenAI Codex
├── .github/
│   └── copilot-instructions.md       # Context for GitHub Copilot
├── .cursor/
│   └── rules/nexusflow.mdc           # Context for Cursor
├── nexusflow.json                    # Feature config (branch, repos, etc.)
├── nexusflow-overview.md             # AI-generated workspace analysis
├── my-api/                           # ← Git worktree on feature branch
└── my-frontend/                      # ← Git worktree on feature branch
```

Open this folder in your editor → your AI assistant picks up the context → it understands *all* your repos.

## 🖥️ Commands

| Command | Description |
|:---|:---|
| `nexusflow create` | Interactive wizard to create a new feature workspace |
| `nexusflow list` | List all existing workspaces (alias: `ls`) |
| `nexusflow open` | Re-open a workspace in your editor |
| `nexusflow init` | Configure NexusFlow settings |
| `nexusflow pack` | Pack the workspace codebase into a single token-efficient XML file |
| `nexusflow start` | Start all services in a workspace (auto-detected) |
| `nexusflow stop` | Stop all running services |
| `nexusflow status` | Show running/stopped status and PIDs |
| `nexusflow logs` | Tail aggregated logs from all services |
| `nexusflow ui` | Launch the interactive Web Dashboard (port 3000) |
| `nexusflow diff` | View changes across all sub-repositories in the active workspace |
| `nexusflow commit` | Commit and push changes across all modified repositories |
| `nexusflow sync` | Rebase all repositories in the workspace with default base branches |
| `nexusflow refresh`| Regenerate codebase maps, plan, and AI context files without rebasing |
| `nexusflow doctor` | Run health checks and diagnostics to verify workspace integrity |

## 🤖 Supported AI Assistants

NexusFlow auto-detects which assistants are available on your machine and generates the right context files for each:

| Assistant | Config File | How It's Detected |
|:---|:---|:---|
| **Claude Code / Antigravity** | `CLAUDE.md` | `claude` or `antigravity` in PATH |
| **OpenAI Codex** | `AGENTS.md` | `codex` in PATH |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Always available |
| **Cursor** | `.cursor/rules/nexusflow.mdc` | `cursor` in PATH |

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

## 🌐 Web Dashboard

Launch with `nexusflow ui` to get a full-featured dark-themed GUI:

- **Workspaces tab** — create, browse, and manage feature workspaces
- **Sessions tab** — view past AI conversation transcripts and resume sessions
- **Logs panel** — real-time aggregated service log output
- **Config panel** — edit NexusFlow settings from the browser

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
│   ├── generators/           # AI context file generators
│   │   ├── base.ts           #   Shared context builder
│   │   ├── claude.ts         #   CLAUDE.md generator
│   │   ├── codex.ts          #   AGENTS.md generator
│   │   ├── copilot.ts        #   copilot-instructions.md generator
│   │   └── cursor.ts         #   nexusflow.mdc generator
│   ├── orchestration/        # Service start/stop/log management
│   └── utils/                # Helper utilities
│       ├── git.ts            #   Git operations
│       ├── detect-ai.ts      #   AI assistant detection
│       ├── detect-editors.ts #   Editor detection
│       ├── session-finder.ts #   AI session history discovery
│       └── prompts.ts        #   Interactive prompts
├── gui/                      # React + Vite Web Dashboard
│   └── src/
│       └── App.tsx           #   Main dashboard component
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