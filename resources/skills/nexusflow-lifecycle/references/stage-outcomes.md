# Expected results by stage

| Stage | Produce | Stop or transition |
| --- | --- | --- |
| Investigate | Reproduction or measurements, evidence for likely causes, remaining unknowns | Return the agreed findings; implementation requires an authorized assignment |
| Design | Intended behavior, acceptance criteria, relevant alternatives and compatibility constraints | Return a reviewable proposal; do not silently start coding |
| Implement | Working behavior for the assigned milestone, with relevant tests and documentation | Verify within authorized scope; do not infer release permission |
| Verify | Results against acceptance criteria, commands, tested revision, failure and recovery evidence | Report pass, failure, or missing evidence; fix within existing authorization |
| Review | Prioritized findings with trigger, impact, location, and expected behavior; usability evidence where relevant | State unresolved blockers and assessment scope; review alone does not authorize edits |
| Release | Current commit checks, review status, compatibility and recovery details when needed | Perform only the requested external actions; verify their results |

For performance work, establish a repeatable baseline before optimizing and compare
the same workload afterward. Report environmental differences and noisy measurements.
For rewrites or migrations, define behavior to preserve and test coexistence or rollback
where applicable. Test a rollback procedure only in an appropriate test environment.

For GUI work, acceptance includes the user's path to the feature, understandable
labels, defaults, and loading, empty, error, and recovery behavior. Use browser evidence
for interaction or visual claims; a successful build proves neither usability nor accessibility.

A concise handoff contains the current stage/milestone, relevant source IDs, decisions,
tested revision and commands, unresolved issues, and the next permitted action. It should
not introduce another authoritative plan or copy entire source documents.
