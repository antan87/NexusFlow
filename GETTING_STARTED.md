# ContextSpace — Getting Started Guide

Welcome to **ContextSpace**! This guide will walk you through the system, explain its core workflows, and show you how to leverage multi-repository workspaces and agentic orchestration to accelerate feature development.

---

## 💡 What is ContextSpace?

When developing complex features in modern systems, you often need to touch multiple repositories simultaneously (e.g., modifying a shared package, updating a backend REST API, and updating a frontend application). 

Traditional AI assistant setups only give the assistant context of a single repository. ContextSpace solves this by:
1. **Grouping Repositories**: Creating a dedicated workspace from ad-hoc repos or a registered project, using isolated **git worktrees** or in-place source repositories.
2. **Generating AI Context**: Writing specialized configurations (`CLAUDE.md`, `AGENTS.md`, Copilot guidelines, and Cursor rules) that outline the workspace architecture.
3. **Smart Codebase Analysis**: Scanning tech stacks, ports, and API endpoints so the AI instantly understands the codebase boundaries.
4. **Service Orchestration**: Running, stopping, and logging all projects simultaneously from a single place.

---

## 🚀 Step-by-Step Workflow

Here is how to get started with your first feature workspace.

```mermaid
flowchart TD
    A["1. Run Web GUI or CLI"] --> B["2. Fill Feature Details & Pick Repos"]
    B --> C["3. Workspace Created\n(Context generated + optional worktrees)"]
    C --> D["4. AI Agent Initializes\n(Fills contextspace-overview.md + questions)"]
    D --> E["5. Confirm Assumptions & Spin up services"]
```

### 1. Initialize ContextSpace
First, initialize the default configuration on your machine:
```bash
ctxspace init
```
This sets up `~/.contextspace/config.json` with default settings:
* **Development Directory**: Where your git repositories are located (defaults to `~/dev`).
* **Workspaces Directory**: Where worktree workspaces are created; in-place workspace directories hold only the manifest and generated AI context files (defaults to `~/dev/workspaces`).

---

### 2. Launch the Web Dashboard
ContextSpace comes with a rich, interactive Web Dashboard. Launch it by running:
```bash
ctxspace ui
```
This starts the local backend server on port `3000` and automatically opens the browser.

---

### 3. Create a Feature Workspace
Via the `ctxspace create` CLI command:
1. **Repo Source**: Choose a registered project or continue with ad-hoc repo scanning.
2. **Work Mode**: Pick **Isolated worktrees** or **In-place**.
3. **Branch or Workspace Name**: Enter a feature branch for worktree mode (e.g. `feature/user-profiles`) or a workspace name for in-place mode.
4. **Description**: Describe the feature you are building. The AI assistant will read this to compile the plan.
5. **Assistant Selection**: Select which AI coding assistants you plan to use (Claude Code, Antigravity, Cursor, etc.).
6. **Finish the Wizard**: ContextSpace runs tech analyses and writes context configurations. In isolated worktree mode it also fetches origin updates, creates local branches, and spins up git worktrees under `workspaces/feature/user-profiles`.

#### Projects

A project is a named, persistent group of source repositories stored centrally in `~/.contextspace/projects.json` (with fallback to `~/.nexusflow/projects.json`). Project ids are slugified from the name (`Hogia Billing` becomes `hogia-billing`), and the command group also has the `proj` alias.

```bash
ctxspace project add -n "Hogia Billing" -r ../api ../frontend -d "Billing repos"
ctxspace project list      # alias: ls
ctxspace project show hogia-billing
ctxspace project remove hogia-billing -y  # alias: rm
```

The add flags are `-n/--name`, `-r/--repos <paths...>`, and `-d/--description`; omit `--repos` to use the interactive repo picker. Removing a project only edits the registry — it never deletes repositories or workspaces on disk, and `remove` accepts `-y/--yes`. The HTTP API exposes the same registry at `GET/POST /api/projects` and `PUT/DELETE /api/projects/:id`.

#### Work modes

| Mode | What happens |
| :--- | :--- |
| **Isolated worktrees** | The classic flow: a feature branch and git worktree per repo inside the workspace directory. |
| **In-place** | ContextSpace works directly in the source repositories. No branches or worktrees are created; the workspace directory holds only `contextspace.json` and generated AI context files. |

In-place workspaces expect you to manage branches yourself: `ctxspace sync` skips source-repo mutation and only reconciles stale generated views, `ctxspace finish` commits and pushes each repo's current branch, and PR/compare links are only offered when that branch differs from the default branch. `ctxspace list` tags them with `[in-place]`, deleting one never touches the source repositories, and agent sessions for single-repo in-place workspaces run in the repo root.

For API users, `POST /api/workspace` accepts optional `mode` (`worktree` default, or `in-place`), `name` (required for in-place), and `projectId`. Existing workspace manifests without a `mode` field are treated as `worktree` mode.

---

### 4. The Agentic Initialization (Universal Context)
Once the workspace is built, open it in your preferred AI assistant. 

Whichever AI harness you use, **the agent's very first instructions** are to:
1. Scan the workspace projects.
2. Read the canonical context instructions in `AGENTS.md`, `CLAUDE.md`, or `.cursor/rules/contextspace.mdc`.
3. Check `contextspace-knowledge.md` and `contextspace-plan.md`.

---

### 5. Orchestrate Local Services
You don't need to open five terminal windows to start your backend, frontend, databases, or libraries.

**On the Web Dashboard:**
* Expand your active workspace to see all detected services (e.g. node scripts, dotnet servers, python hosts).
* Click **Start All** to spin them up.
* View aggregate console streams inside the tabbed retro-terminal output screen.

**Via the CLI:**
* Navigate to your workspace directory and run:
  ```bash
  ctxspace start
  ```
* Check logs or stop services with:
  ```bash
  ctxspace logs
  ctxspace stop
  ```

### 6. Equip Reusable Skills and Codex Agents
Equip your AI assistants with reusable resources using the **Resource Library**:
- Navigate to the **Resource Library** in the Web Dashboard and choose Skills or Codex Agents.
- Browse built-in category templates (Pull Request review, Testing & QA, Cross-Repo package loop, Database migrations, Security audit).
- Drag and drop cards to re-categorize skills, create custom categories, or author new skills with Markdown playbooks and auxiliary scripts.
- Create or import basic Codex custom-agent TOML definitions and reuse them across workspaces.
- Save a workspace selection, then refresh. Portable skills are installed to `.agents/skills/` (and `.claude/skills/` for Claude); Codex agents are installed to `.codex/agents/`.
- ContextSpace records owned output hashes in `.contextspace/resources.lock.json`, refuses unmanaged collisions, and never removes a locally modified managed file.

### 7. Capture Learnings as You Go
As you (or your AI assistant) make decisions and hit gotchas, record them so they aren't lost between sessions:
```bash
ctxspace knowledge add -t decision --title "short-lived auth tokens" -m "Switched auth to short-lived tokens"
ctxspace knowledge add -t gotcha --title "worker redis requirement" --scope "repo:worker" -m "The worker needs REDIS_URL set locally"
```
Entries are filed under the right section of `contextspace-knowledge.md` automatically. Your AI assistant can do the same through the `add_knowledge` MCP tool.

### 8. Finish the Feature
When the work is done, close the loop in one command:
```bash
ctxspace finish --dry-run          # preview: what will be committed / pushed
ctxspace finish -m "Ship feature"  # commit + push every repo, print PR links
```
`finish` shows a per-repo status table, commits and pushes each repo, and prints ready-to-open PR/compare links for each remote. In isolated worktree workspaces it uses the feature branches ContextSpace created; in-place workspaces use each repo's current branch and only offer PR/compare links when that branch differs from the default branch. It then offers to **promote** reusable learnings into each repo's persistent base knowledge, and — with `--cleanup` — removes the workspace once everything is safely pushed.


---

## 🛠️ CLI Reference

Here is a summary of the command-line interface:

| Command | Usage | Description |
| :--- | :--- | :--- |
| **`ctxspace ui`** | `ctxspace ui [-p <port>]` | Starts the backend Hono API server and opens the GUI Dashboard. |
| **`ctxspace create`** | `ctxspace create` | Launches the interactive wizard to build a worktree or in-place workspace. |
| **`ctxspace list`** | `ctxspace list` / `ctxspace ls` | Lists all active feature workspaces, tagging in-place ones with `[in-place]`. |
| **`ctxspace open`** | `ctxspace open` | Prompts you to pick an active workspace and opens it in your editor. |
| **`ctxspace start`** | `ctxspace start [path]` | Starts background processes for all projects in the workspace. |
| **`ctxspace stop`** | `ctxspace stop [path]` | Kills all running processes for the workspace. |
| **`ctxspace logs`** | `ctxspace logs [path] [-n <lines>]` | Tails output log files for all service processes in the workspace. |
| **`ctxspace status`** | `ctxspace status [path]` | Displays live repo state, context freshness, and service status. |
| **`ctxspace progress`** | `ctxspace progress [path]` | Derives expected-branch alignment, push, and available PR progress from live state; push/PR state is omitted on the wrong branch. |
| **`ctxspace init`** | `ctxspace init` / `ctxspace init --workspace [path]` | Edits global config or adopts an existing workspace as a git-backed artifact. |
| **`ctxspace project`** | `ctxspace project add` / `list` / `show` / `remove` | Manages registered repo groups (alias: `proj`). |
| **`ctxspace diff`** | `ctxspace diff` | Displays pending code changes across all active workspace repositories. |
| **`ctxspace commit`** | `ctxspace commit` | Automates cross-repository git commit and branch pushes in the workspace. |
| **`ctxspace sync`** | `ctxspace sync` | Rebases worktree-mode repos and reconciles generated views; in-place mode skips repo mutation. |
| **`ctxspace finish`** | `ctxspace finish [-m <msg>] [--cleanup] [--dry-run]` | Closes out a feature: commits & pushes all repos, opens PRs / prints compare links, promotes learnings, and optionally removes the workspace. |
| **`ctxspace knowledge`** | `ctxspace knowledge add -t <type> --title <title> -m <msg> [--scope ...]` / `show` / `promote` | Captures searchable scoped learnings; identical retries do not duplicate entries, and local Git commit failures are reported separately from successful storage writes. |
| **`ctxspace refresh`**| `ctxspace refresh [--check]` | Regenerates context or checks `contextspace.lock` and generated-view drift. |
| **`ctxspace remote`** | `ctxspace remote add|push|pull` | Synchronizes the workspace artifact repository without touching child repo remotes. |
| **`ctxspace doctor`** | `ctxspace doctor` | Assesses and reports diagnostics of the current workspace setup. |
