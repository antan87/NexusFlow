# Repository verification

Follow the current `AGENTS.md` and package scripts. Before submitting code changes,
run `npm run build:backend` and `npm test`; GUI changes also require
`npm run build --prefix gui`. Do not embed expected test counts in this guide.

During implementation, select checks by affected behavior:

| Change | Useful evidence |
| --- | --- |
| CLI/API | Real command/request behavior, validation failures, clean JSON and exit status |
| Storage | Configured adapter exercised, original content retained, failed writes recoverable |
| Shared state | Concurrent edits do not lose unrelated data; stale revisions rejected |
| Generated resources | Regeneration from source, repeatability, provenance and source-file preservation |
| GUI | Actual user journey, loading/empty/error states, draft preservation, keyboard and label behavior |
| Verification engine | Gate uses the tested input, failed/stale/unreadable snapshots cannot permit progress |
| Compatibility/migration | Old and new persisted inputs, supported aliases, failure/recovery paths |

Run the relevant existing suites and add regressions for concrete failures. Do not
write tests that merely restate implementation or assert arbitrary prose. Browser
tests should wait for observable navigation/request completion, not fixed sleeps.
Passing mocked UI tests does not prove the backend integration; pair them with API
tests where the change crosses that boundary.

Use environment-specific workarounds only after establishing why they are needed.
For example, `npm test -- --configLoader native` can avoid Vite writing beside a
read-only configuration cache; it is not a universal substitute for repository scripts.
Missing permissions or dependencies are unavailable evidence, not a passing test.
