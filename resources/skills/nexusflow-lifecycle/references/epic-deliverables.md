# Plan usable increments

Start from the user's outcomes. Where practical, a milestone should deliver a small
usable capability across the required layers. For invoice performance, examples are
measuring representative latency, improving one supported lookup path, and rolling
the change out with monitoring. A necessary infrastructure-only prerequisite is valid,
but name its consumer and acceptance criteria instead of claiming it is user-visible.

For each milestone, capture its outcome, acceptance criteria, dependencies, intended
branch/PR, compatibility constraints, and verification evidence. Include rollout and
recovery details when the change affects persistent data or deployed consumers.
Branch labels in the plan are intentions; verify actual branches and PRs separately.

Sequence only actual dependencies. Independent deliverables can proceed concurrently
when isolation and ownership are clear. Each mergeable increment must build and pass
its applicable gates. For stacked PRs, record the base branch and merge order; recheck
dependent PRs after their base changes.

Preserve milestone IDs referenced by documents and assignments. The current editor
can add/edit milestones but does not delete existing ones. Record canceled outcomes
explicitly rather than marking unimplemented behavior as delivered; if restructuring
requires unsupported operations, explain the limitation and agree a supported plan.
