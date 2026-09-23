# Documents, assignments, and milestones

Open a workspace's **Plan** tab to manage its sources, current AI assignment,
and milestones. These serve different purposes:

| Information | Where it belongs |
| --- | --- |
| Short reason for the workspace | Task brief |
| Product requirements, designs, measurements, background | Source documents |
| What the AI should do now and where it should stop | AI assignment |
| Deliverables, dependencies, branches, verification and progress | Milestone plan |
| Decisions and lessons discovered during development | Knowledge |

Avoid copying an entire product specification into the brief, plan, and knowledge.
Keep the original as a source and record only the additional information each needs.

## Add a product owner's document

Under **Source documents**, upload Markdown or plain text, paste text, or add an
HTTP(S) link. Text uploads support `.md`, `.markdown`, and `.txt`, up to 500 KB.
Use links for PDF, Word, or online documents; this version does not extract their
contents or fetch links automatically.

Give each document a title and choose:

- **Role:** requirements, design, evidence, or reference.
- **Status:** draft (the default), approved, or superseded.
- **Scope:** the whole workspace, a particular milestone, or the entire registered project.

An optional owner summary highlights relevant details without replacing the
original. Editing labels preserves uploaded text. For a revised source, add the
new document and supersede the old one. Superseded sources remain readable as
history while their owning workspace exists, but are excluded from AI assignments.

Project sources are shared by reference across workspaces attached to the same
registered project. Add them to a stable project or epic workspace and edit them
there. They are stored with that workspace, not in a separate project library.
Workspace deletion refuses to remove active project sources. To retire the owner,
copy sources to another project workspace if still needed, then supersede the originals.

## Direct the current work

Set **work type**, **size**, and **current stage** independently:

- Type describes the change: bug, feature, performance, refactor, or rewrite.
- Size describes its scope: small task, standard change, or epic.
- Stage describes today's assignment: investigate, design, implement, verify, review, or release.

Changing type or size does not reset progress or replace milestones. New-work size
presets supply an initial plan; use **Edit milestones** to adapt it later.

State the current objective, expected output, and stopping point. Select a milestone
when the assignment concerns only that deliverable. Workspace and project sources
remain relevant; milestone sources are included only for the selected milestone.
Investigation and design assignments explicitly stop before implementation.
Stages guide the AI; they are not an execution sandbox or an automatic approval system.

For example, a performance rewrite can begin with an investigation assignment:
“Measure invoice lookup latency; return a baseline and likely causes; stop before
changing code.” Later, advance the assignment to design and then implementation.
The same sources and milestone progress remain available throughout.

## Split larger work into deliverables

Edit milestone titles, outcomes, branches, dependencies, and verification gates.
Add milestones for separate increments or PRs. The editor preserves existing IDs
and progress; existing milestones cannot currently be deleted. Branch labels
describe the intended work; saving them does not create branches or PRs.

Circular dependencies, stale saves, and changes to completed verification gates
are rejected. Visual Flow and the displayed Markdown plan use the same saved
milestones. The generated plan file contains milestone definitions; live progress
is available in the UI and CLI.

## Give an AI the current context

Save the assignment, then use **Copy AI assignment**, or run:

```sh
ctxspace flow --assignment
ctxspace flow --assignment --json
```

MCP clients can call `get_work_context`, then `read_work_document` using document
IDs in the assignment. Read originals before relying on summaries. Approved
requirements establish intended behavior; drafts are proposals. Conflicting
sources should be surfaced to the owner.

### Planning through MCP

The `interactive`, `developer`, and `full` MCP roles can manage planning directly.
The `readonly`, `review`, and `ci` roles can read planning context but cannot edit it.
Reconnect an already running MCP server after upgrading to discover new tools.

- `get_work_context` returns `guidance` (including the assignment, documents, and
  revision), `lifecycle`, shared project sources, and the rendered assignment.
- `update_milestone_plan` accepts `revision` from `lifecycle.revision` (0 when
  absent) and the complete desired `steps` array. Retained IDs preserve progress;
  omitted IDs are removed. `steps: []` disables milestones. Move any assignment
  and source-document scopes before deleting milestones they reference.
- `update_work_assignment` accepts `guidance.revision`, `workType`, `size`, and
  the complete `assignment`. Omit `milestoneId` to use workspace scope. Saving a
  stage is not authorization to exceed the user's requested scope.
- `add_work_document` accepts `guidance.revision`, `title`, `role`, optional
  `status`/`scope`/`summary`, and exactly one of `content` or `url`. New documents
  default to draft. Links are stored without fetching their contents.
- `update_work_document` accepts `guidance.revision`, `documentId`, and the full
  document metadata. It preserves original text and URLs. Use `scope: {}` for
  workspace scope and `status: "superseded"` to retain a source as history.
- `save_planning_notes` accepts the revision hash from `get_planning_notes` and
  the complete revised `content`.

All writes reject stale revisions. Reread and merge after a conflict rather than
retrying an old replacement. Write results return the new revision. Call
`refresh_context` after editing milestone definitions to regenerate the Markdown
plan. These tools manage workspace planning; Workroom completion proposals still
use the separate Workroom approval flow.

For maintainers, `npm run build:backend` followed by
`node scripts/smoke-mcp-planning.mjs` checks actual stdio discovery, planning edits,
read-only denials, and conflict recovery in temporary workspaces without model calls.

`contextspace-work.json` is the authoritative assignment and document index.
Original text and metadata use the configured workspace storage adapter.
`contextspace-assignment.md` is a derived view. Prefer live CLI/MCP reads because
another project workspace can update a shared source after that view was written.
Run `ctxspace refresh` to update generated context pointers in older workspaces
and regenerate derived views. Generated context is not a second place to edit the assignment.

## Keep authored planning across refresh

**Delivery notes & questions** edits `contextspace-milestones.md`. Refresh creates
this document once and preserves subsequent edits. It contains release sequencing,
questions with owners and open/resolved status, existing work with branch/PR/commit
evidence, and flag-only or deferred decisions. Record what is already merged, on a
branch, or needs no change before defining new work. Link these rows to milestone
IDs and source documents instead of copying their contents. This register is
Markdown; saving it does not automatically complete lifecycle gates or execute work.

Use **Edit milestones** for executable dependencies and verification gates. Each
milestone can name a repository, branch, work item or PR, and unblock condition.
Circular milestone dependencies are invalid, but circular *package* dependencies
can be legitimate. The dependency analysis does not invent a release order for
cycles: record producer build, package publication, and consumer-version bumps in
the authored plan, including compatibility transitions for breaking contracts.

When upgrading, a manually appended `## Milestones` section in the old generated
plan is copied into the new authored document before regenerating the plan. Review
that imported section once. Other custom sections should be moved into the authored
document before refresh. Do not edit generated `contextspace-plan.md` directly.

Notes saves use a revision check. A conflicting save keeps the editor draft;
copy any changes you need before using **Reload delivery notes**, which replaces
it with the latest saved text. MCP exposes the document through `get_planning_notes`.

For skill-based PBI generation, select the applicable skill and make the assignment
explicit, for example: “Use the enabled PBI template; inventory existing work, draft
one work item per remaining milestone, link its evidence, and stop before code.”
Store generated work items as draft source documents. Skills provide procedures;
enabling one does not run it or make its output approved.

Knowledge already supports typed `decision`, `question`, and `gotcha` entries,
rendered with their type labels. Use knowledge for compact reasons and lessons;
use delivery notes for the evolving question owner, status, and resolution register.

## Access tools from a desktop-created workspace

If `ctxspace` is not on PATH, use the generated workspace launcher with the same
arguments. From the workspace root:

```sh
./.contextspace/bin/ctxspace flow --assignment
./.contextspace/bin/ctxspace isolate <repo>
```

In PowerShell use `.\.contextspace\bin\ctxspace.cmd`. These launchers use the
installed runtime and CLI, including desktop's bundled Electron-as-Node runtime;
they do not download a package. Refresh after moving or upgrading the installation.
The launcher creates no global PATH entry. Host repositories remain read-only until
isolated; tool access is not permission to bypass that rule.

MCP configurations are generated for selected assistants: Claude's `.mcp.json`,
Cursor's `.cursor/mcp.json`, Copilot's `.vscode/mcp.json` and `.mcp.json`, and Codex's
`.codex/config.toml`. Other MCP servers/settings are retained. Trust the workspace
in the assistant to enable its interactive tools. Antigravity uses user-level MCP
configuration; configure it there or use the local CLI launcher.

## Diagnose workspace skills

The Skills tab includes workspace-local packages in selection validation and shows
invalid-package, missing-global-source, and duplicate-ID diagnostics. A valid local
package takes precedence over the same global ID. A workspace package labeled
`scope: global` requires its source in the global catalog; restore that source or
correct the scope if it is an authored local skill.

Explicit selection controls deployment; deselecting a local skill removes its
managed Claude copy. Authored `.agents/skills` files are preserved, so assistants
that discover this folder directly may still see them. Move an authored skill out
of that discovery folder if it must be unavailable to those assistants. General
and uncategorized skills are grouped together in the UI. Agent selection currently
uses the global agent catalog; it has no workspace-local agent catalog.
