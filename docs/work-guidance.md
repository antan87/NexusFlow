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

`contextspace-work.json` is the authoritative assignment and document index.
Original text and metadata use the configured workspace storage adapter.
`contextspace-assignment.md` is a derived view. Prefer live CLI/MCP reads because
another project workspace can update a shared source after that view was written.
Run `ctxspace refresh` to update generated context pointers in older workspaces
and regenerate derived views. Generated context is not a second place to edit the assignment.
