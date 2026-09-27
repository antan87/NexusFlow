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

In a fresh worktree, reproduce CI's order before judging failures: install the root
and `gui/` dependencies from their lockfiles, run `npm run build`, then `npm test`.
Suites that need GUI dependencies or `dist/` fail without it. The harness test that expects
`AuthRequiredError` fails on a machine signed in to Claude; treat that as an
environment difference, confirmed by CI, not as a regression.

Release gate: adding, renaming or making conditional a job in `ci.yml` or
`security.yml` requires updating `.github/release-required-checks.json` and the
branch protection on `main` in the same PR (see `RELEASING.md`, Publish gate).
