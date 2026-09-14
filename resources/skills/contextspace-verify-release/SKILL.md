---
name: contextspace-verify-release
description: Verify a ContextSpace-managed change, assess PR readiness, or execute an explicitly requested push, merge, or release using evidence tied to the current code revision. Use when verification or delivery is the task, not for every edit.
metadata:
  contextspace:
    title: ContextSpace Verification and Release
    category: workflows
    tags: [contextspace, verification, review, release]
---

# Establish readiness from current evidence

Resolve the requested workspace, branch, PR, assignment, and acceptance criteria.
Inspect the current diff and repository-required checks. Select additional evidence
according to the affected behavior and impact; use [verification evidence](references/evidence.md).
Do not impose ContextSpace's own npm commands on unrelated projects.

## Review and verify

Check intended behavior, regressions, compatibility, and consequential failure paths.
For interface changes, assess the actual user's journey and recovery behavior with
browser evidence. Report concrete findings by severity, with trigger, impact,
location, and expected behavior. Distinguish inspected behavior from assumptions.

Record commands, results, tested commit, and any uncommitted changes included in a
local test. An unavailable check is not a pass. Reuse applicable evidence while
the tested input is unchanged; rerun affected checks after fixes.

## Push or assess merge readiness

Before a requested push, inspect pending changes and the remote branch; stage only
the intended paths. Preserve unrelated work. Follow the repository's commit convention.
After pushing, confirm the PR's head SHA matches the intended commit and watch its
checks. Inspect failures and fix issues within the user's authorized scope.

Before declaring readiness, read the current PR head, relevant diff/review findings,
required checks, draft status, and mergeability. Compare the head with the reviewed
and verified revision. If it changed, inspect the added changes and verify the new
head. Green checks on an earlier commit do not establish readiness for a newer one.
Pending checks, unresolved blocking findings, and missing required approvals must be
reported as outstanding. No review submitted is different from an approved review.

An assessment or push request does not itself authorize merging or publishing.
When those actions are requested, perform the applicable checks first and verify
the resulting remote state. For deployments or migrations, include the relevant
rollout and recovery plan. Do not deploy to a test or production service merely
to produce evidence unless that action is within the assignment.

Conclude with the exact revision, verification outcome, unresolved blockers or
limits, and which requested external actions actually completed. Link to CI/PR
evidence. Avoid an unconditional merge-ready claim from tests alone.
