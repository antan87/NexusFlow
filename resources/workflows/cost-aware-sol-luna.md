# Cost-Aware Sol Control + Luna Worker

Use Sol for read-only inspection, planning, and independent review while one Luna/max worker performs bounded implementation.

## Capability boundary

This is an advisory coordination strategy. NexusFlow stores and injects these instructions but does not itself launch roles, enforce model or reasoning-effort selection, create a fresh reviewer context, or wait for provider rate-limit resets. The developer or selected agent harness must perform and verify those controls. If the harness cannot assign the required role settings, stop and ask the human instead of claiming this strategy was enforced.

## Required role configuration

| Role | Model | Reasoning effort | Workspace access |
| --- | --- | --- | --- |
| Inspector and planner | `gpt-5.6-sol` | `high` or above | Read-only |
| Implementation worker | `gpt-5.6-luna` | `max` | Workspace write |
| Independent reviewer | `gpt-5.6-sol` | `high` or above | Read-only |

The coordinator may be the inspector and planner. The reviewer must start with a fresh context after implementation and must not edit files. Sol may write code only after explicit human approval.

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
   - Ask for correctness, security, regression, boundary, and missing-test findings. Each finding must include severity, location, evidence, and expected behavior.
   - The reviewer reports only; the Luna worker applies accepted fixes.
4. **Close the loop**
   - Rerun affected verification after every fix and review the new frozen diff.
   - Allow at most two worker-review correction loops before asking the human to decide whether to narrow the slice, accept a documented risk, or continue.
   - Finish with the outcome, files changed, checks run, review result, and remaining risks.

## Rate-limit and cost rules

- Reuse active role sessions and checkpoint before pausing. A timeout or delayed response is not permission to create a duplicate agent.
- If a role is rate-limited, preserve its work packet and wait for that role to become available. Manual work may continue from the same packet.
- If Luna is unavailable, ask the human before using `gpt-5.6-terra` at `max` as the implementation worker.
- Never silently upgrade implementation to Sol. If Sol is unavailable for planning or independent review, pause at that gate or request explicit human approval for a named substitute.
- Keep raw logs, repeated repository summaries, and broad file dumps out of handoffs. Prefer exact paths, decisions, diffs, and test results.

## Manual cooperation

A developer may perform any role manually. Record the same work packet and review evidence so another developer or agent can take the next turn without reconstructing the session. In a Workroom, publish the strategy and update shared plan, decision, handoff, and workflow evidence; source code and diffs remain in each developer's local checkout.
