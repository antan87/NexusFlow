# Choose by uncertainty and impact

| Situation | Starting workflow | Evidence or planning needed |
| --- | --- | --- |
| Understood, localized, reversible change | Small task | Reproduction or observable acceptance check; relevant regression gate |
| One cohesive capability with some unknowns | Standard change | Resolve important unknowns; define acceptance criteria and failure behavior |
| Multiple independently reviewable deliverables | Epic | Outcomes, dependency graph, compatibility boundaries, handoffs |
| Authentication, data migration, public contract, or hard-to-reverse change | Any size, deeper verification | Failure analysis, compatibility and recovery evidence appropriate to the impact |
| Performance investigation | Investigate stage, any size | Representative workload, baseline, measurement method; no speculative rewrite |

Choose isolation separately. `ctxspace quick` creates an in-place workspace;
`ctxspace create` creates a standard workspace and supports mode selection.
`ctxspace create --flow epic` selects an epic preset. Check the installed CLI's
`--help` for its available flags; presets do not create a stack of PRs automatically.
A small task may use a worktree for isolation. Existing workspaces can change their
assignment size and milestone definitions without resetting progress.

Increase workflow depth when investigation uncovers data loss risk, cross-service
compatibility constraints, or separately releasable outcomes. Explain the finding and
adapt the existing plan. Reduce unnecessary ceremony when evidence resolves uncertainty.
Do not require a research document, new test file, approval, or agent team for every tweak.
