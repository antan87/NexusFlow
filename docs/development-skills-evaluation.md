# Development skill evaluation — 2026-09-14

This report covers the skill sources carried from the v2.12.0 branch, before the
post-release fixes for #253 and #254. The later local-launcher and authored-delivery-note
guidance received structural checks and manual review, not a repeat independent
scenario evaluation.

The three source skills were evaluated by an independent agent given only the
skill files, relevant references, and scenario prompts. The evaluator did not see
the expected rubrics or this implementation conversation. Responses were compared
with `tests/fixtures/development-skill-scenarios.json` afterward.

| Scenario | Observed decision | Assessment |
| --- | --- | --- |
| small-bug | Preserved the worktree; used existing reproduction and applicable gates | Meets rubric |
| performance-investigation | Established comparable measurements; treated the rewrite draft as a proposal; stopped before coding | Meets rubric |
| one-file-migration | Assessed compatibility, old data, retries and recovery despite small file count | Meets rubric |
| epic-deliverables | Sequenced filtering after search and allowed independent export work | Meets rubric |
| conflicting-sources | Surfaced conflicting approved retention requirements; continued unaffected investigation | Meets rubric |
| changed-pr-head | Rejected readiness based on old CI; required current-head inspection and checks | Meets rubric |
| gui-recovery | Treated draft loss as a blocker and requested browser/API recovery evidence | Meets rubric |
| revised-assignment | Accepted the user's new implementation authorization without asking again | Meets rubric |
| maintainer-storage | Used the storage port, fresh locked mutations, and concurrency/recovery checks | Meets rubric |

No blocking contradiction was found. The evaluator noted that updating an assignment
uses the Plan editor or available workspace tools; the guidance does not claim a
nonexistent CLI mutation command. Missing migration requirements and conflicting
retention rules remained explicit unresolved inputs.

This was an evaluation of proposed actions and stopping points, not execution of
nine development projects. It does not prove code correctness, GUI usability, or
consistent behavior across every model. Structural validation and repository tests
provide separate evidence; rerun the scenarios after material guidance changes.
