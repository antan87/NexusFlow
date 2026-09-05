# Cost-Aware Sol Control + Luna Worker

Use a cheaper Luna/max worker for bounded implementation and a more capable,
expensive Sol worker for independent review in a fresh context. Accepted review
feedback returns to the same cheaper builder until the explicit acceptance
criteria are met.

## Capability boundary

This is an advisory coordination strategy. NexusFlow stores and injects these
instructions but does not itself launch roles, enforce model, cost tier, or
reasoning-effort selection, guarantee provider pricing/capability, create a
fresh reviewer context, track acceptance, or wait for provider rate-limit
resets. The developer or selected agent harness must perform and verify those
controls. “Cheaper” and “more capable/expensive” describe the requested role
relationship; they are not a claim about a provider's current pricing or
models. If the harness cannot assign the required role settings, create an
independent context, or observe the safety guard, stop and ask the human
instead of claiming this strategy was enforced.

## Required role configuration

| Role | Cost/capability target | Model | Reasoning effort | Workspace access |
| --- | --- | --- | --- | --- |
| Inspector and planner | Read-only planning gate | `gpt-5.6-sol` | `high` or above | Read-only |
| Implementation builder | Cheaper model | `gpt-5.6-luna` | `max` | Workspace write |
| Independent reviewer | More capable/expensive model | `gpt-5.6-sol` | `high` or above | Read-only |

The coordinator may be the inspector and planner. The reviewer must start with
a fresh context after every builder pass, must not edit files, and must not be
the builder's conversation. Sol may write code only after explicit human
approval.

## Acceptance contract

Before the first builder pass, the coordinator records observable acceptance
criteria in the work packet. At minimum, criteria cover:

- the requested behavior and its important edge cases;
- targeted tests and relevant regression checks, with the evidence required to
  pass them;
- security, data-safety, and capability-boundary invariants; and
- the exact in-scope paths, non-goals, and documentation obligations.

The reviewer returns one of these explicit verdicts:

- **ACCEPTED** — every required criterion is met with evidence and no
  unresolved finding violates the contract;
- **CHANGES REQUESTED** — one or more criteria are unmet, with each actionable
  finding identified by severity, criterion, evidence, and expected behavior;
  or
- **BLOCKED** — the reviewer cannot independently verify the contract (for
  example, the required context, tests, role, or provider is unavailable).

The coordinator triages findings against the work packet. Only feedback that
is accepted as in-scope is sent to the same Luna builder; disputed or
out-of-scope feedback is documented and escalated to the human.

## Workflow

1. **Inspect and plan with Sol**
   - Read the repository instructions, relevant code, tests, and current diff.
   - Produce a bounded work packet containing the outcome, exact scope and paths, invariants, acceptance tests, non-goals, risks, and recovery notes.
   - Split large features into independently verifiable vertical slices. Do not send the worker an open-ended request to explore the whole repository.
2. **Implement with one Luna/max worker**
   - Give the worker the work packet plus only the context needed for the current slice.
   - Keep a single writer. Do not run parallel writers against the same checkout.
   - Require concise checkpoints listing changed files, verification run, and blockers. Reuse this worker for fixes instead of creating another implementation session.
3. **Review with fresh Sol**
   - Freeze the diff and give the reviewer the work packet, changed paths, and verification evidence.
   - Ask for correctness, security, regression, boundary, and missing-test findings using the verdicts in the acceptance contract. Each finding must include severity, criterion, location, evidence, and expected behavior.
   - The reviewer reports only; the Luna worker applies accepted fixes.
4. **Return accepted feedback to Luna**
   - For **CHANGES REQUESTED**, send only the accepted, in-scope findings to the same Luna builder. Require a checkpoint with changed paths, verification output, and which criteria are now satisfied.
   - Rerun affected verification after every fix, freeze the new diff, and start another fresh Sol review. Do not silently switch writers or reuse the reviewer's context.
5. **Terminate or escalate from the verdict**
   - **ACCEPTED** is the only automatic success/termination path. Finish with the criteria evidence, files changed, checks run, review verdict, and remaining risks.
   - On **BLOCKED**, a missing role/context/provider, conflicting feedback, or no measurable progress on a repeated finding, pause and ask the human whether to restore the prerequisite, revise the scope/criteria, accept a documented risk, or continue.
   - Before work starts, the coordinator must record at least one finite safety guard (for example an iteration, wall-clock, token, or cost budget) and checkpoint each pass against it. Reaching the guard pauses the workflow and requires an explicit human decision; it never auto-accepts, silently continues, or silently abandons unmet criteria. A guard is a safety escalation, not a substitute for acceptance, so there is no arbitrary fixed correction-loop cutoff.

## Rate-limit and cost rules

- Reuse active role sessions and checkpoint before pausing. A timeout or delayed response is not permission to create a duplicate agent.
- If a role is rate-limited, preserve its work packet and wait for that role to become available or ask the human for a named substitute. Do not claim an acceptance verdict while the independent reviewer is unavailable. Manual work may continue from the same packet only when it preserves the role and acceptance contract.
- If Luna is unavailable, ask the human before using `gpt-5.6-terra` at `max` as the implementation worker.
- Never silently upgrade implementation to Sol. If Sol is unavailable for planning or independent review, pause at that gate or request explicit human approval for a named substitute.
- Keep raw logs, repeated repository summaries, and broad file dumps out of handoffs. Prefer exact paths, decisions, diffs, and test results.

## Manual cooperation

A developer may perform any role manually. Record the same work packet, safety
guard, builder checkpoints, and review verdicts so another developer or agent
can take the next turn without reconstructing the session. In a Workroom,
publish the strategy and update shared plan, decision, handoff, and workflow
evidence; source code and diffs remain in each developer's local checkout.
