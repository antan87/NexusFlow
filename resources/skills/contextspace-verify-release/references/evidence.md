# Evidence proportional to the change

| Change | Establish |
| --- | --- |
| Localized bug | Original failing behavior, corrected behavior, relevant regression coverage |
| Performance | Representative workload and baseline, comparable result, correctness preserved |
| Public contract | Existing consumers remain compatible or a coordinated migration is defined |
| Persistent data | Representative old inputs, retry/failure behavior, recovery feasibility |
| UI flow | Discoverability, understandable defaults, keyboard access, loading/empty/error/retry behavior |
| State/storage | Adapter routing, concurrent updates, interrupted writes and stale-save recovery |
| Generated instructions | Correct source, reproducible output, valid references and runnable documented commands |

Separate local evidence from remote evidence. For local tests, record the commit and
whether the worktree contained edits; the commit alone does not identify those edits.
For PR checks, record the head SHA and run links. When CI tests a synthetic merge
commit, confirm the run corresponds to the current PR head and base.

For existing repositories, discover required commands from repository instructions,
package/build scripts, and CI. Run applicable gates, not unrelated tools merely
because they appear in a generic checklist. A successful build cannot demonstrate
an accessible interface, a safe migration, or satisfied product requirements.
