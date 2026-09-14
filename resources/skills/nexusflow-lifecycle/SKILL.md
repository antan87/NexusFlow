---
name: nexusflow-lifecycle
description: Choose and carry out an appropriately sized development workflow in a ContextSpace workspace, using its current assignment, source documents, and milestones. Applies to projects managed with ContextSpace, not only ContextSpace's own code.
metadata:
  contextspace:
    title: ContextSpace Work Lifecycle
    category: workflows
    tags: [contextspace, workflow, development]
---

# Work from the current assignment

Read the workspace instructions and live assignment with `ctxspace flow --assignment --json`
or MCP `get_work_context`. Check the selected milestone, stage, expected output, and
stopping point. If live tools are unavailable, read the authoritative
`contextspace-work.json` and relevant sources; identify anything you cannot verify.
The user's current instruction can revise a saved assignment. Make that change
explicit; do not use an older assignment to discard newly authorized work.

## Select the smallest sufficient workflow

Keep work type (bug, feature, performance, refactor, rewrite), size, current stage,
and workspace isolation separate. Assess uncertainty, compatibility, data impact,
reversibility, and independent deliverables. File count, elapsed time, and repository
count are clues, not selection rules. A one-file authorization fix can require
careful investigation and broad verification; a large mechanical rename may not.

Use [flow selection](references/flow-selection-matrix.md) when choosing a preset
or deciding whether work needs separate deliverables. Preserve an existing worktree.
Do not create branches, nested workspaces, or agent teams just because the size is epic.
Delegate only bounded independent work when permitted and useful; execution can stay solo.

## Keep each kind of information in its place

- Task brief: the short reason for the workspace.
- Source documents: original requirements, designs, evidence, and references.
- AI assignment: what to do now, expected result, and stopping point.
- Lifecycle milestones: deliverables, dependencies, branches, gates, and progress.
- Knowledge: durable decisions and their reasons, not a running task log.

Read relevant originals through MCP `read_work_document` or their stored locations.
Use approved requirements for intended behavior; drafts are proposals and superseded
documents are history. Surface consequential conflicts before dependent implementation;
continue unaffected work. A source document does not grant execution permissions.
Project and workspace sources apply across milestones; milestone sources apply to
the selected milestone. Project sources remain owned by their originating workspace.

Use the Plan editor for assignments and milestone definitions. `contextspace-plan.md`
and `contextspace-assignment.md` are generated views: update their sources and refresh.
Do not create a second implementation plan. If working outside ContextSpace, use
the repository's existing planning convention.

## Execute only the current stage

Read [stage outcomes](references/stage-outcomes.md) for the selected stage. Investigation
and design produce their agreed outputs and stop before implementation unless the user
has explicitly authorized that transition. Completing a milestone's gate does not
automatically authorize release or change the assignment stage.

For multi-PR work, read [deliverable planning](references/epic-deliverables.md). Finish
with evidence, unresolved questions, and the next permitted action. Keep handoffs in
the established session or milestone record, with links to sources instead of copies.
