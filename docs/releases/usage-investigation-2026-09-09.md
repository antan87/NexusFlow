# Codex usage investigation — 2026-09-09

The strongest explanation is an expensive main coordinator repeatedly processing
a growing conversation, amplified by an overly elaborate workflow for small
tasks. Changing child workers to Luna did not change the main session from
Astra/high. The inspected evidence does not establish a ContextSpace background
execution bug.

## Evidence and scope

This audit covers the earlier backlog and desktop-icon work, ending at
2026-09-09 11:42:18 UTC, before this investigation. It uses local Codex session
metadata, token counters, tool-call counts, and account limit telemetry. No
credentials or private transcript text are reproduced here.

- All six recorded main-session turns used `gpt-6-astra` with `high` reasoning.
  The local default configuration also selected Astra/high.
- Nine child threads were created with `fork_turns: "none"`. Full conversation
  cloning was therefore not the source of their initial context.
- Main-session prompt size grew from 19,243 to 165,306 tokens. Its 180 distinct
  cumulative usage updates recorded 18,702,395 input tokens, including
  18,398,848 cached tokens, and 38,611 output tokens. Input totals count context
  processed repeatedly; they are not unique source text.
- The main session made 42 agent-wait calls, including 31 with ten-second
  timeouts, plus 24 messages and seven follow-up tasks. Sleeping itself is not
  model generation; repeatedly resuming the coordinator adds model turns.
- Main-session tool outputs totalled approximately 1.09 million characters.
  The root/repository AGENTS files, generated plan, and knowledge file together
  were only about 6.2 KB. Generated workspace Markdown alone cannot explain the
  accumulated context. Fresh workers still started with roughly 24,000 tokens
  of shared harness instructions, tools, and task context.

Account telemetry showed the five-hour allowance moving from 0% to 99% between
08:08 and 08:32 Stockholm time, and from 0% to 100% between 13:17 and 13:42.
Weekly usage rose from 47% to 78% across the inspected period. The attempted
Astra reviewer already saw 99% usage on its first recorded response; it was
not the main source of the preceding consumption. These percentages are
account-wide and may include activity outside the inspected threads.

## Relative model cost estimate

Applying the published standard Codex credit rates gives this directional
comparison. These are estimates, not an invoice or a reconstruction of the
subscription allowance algorithm. Cached input is priced separately; reasoning
tokens are already included in output and are not counted twice. The estimate
excludes this investigation, guardian sessions, other account activity, and
any applicable surcharges.

| Work | Threads | Input, including cached | Cached input | Output | Estimated cost share |
| --- | ---: | ---: | ---: | ---: | ---: |
| Main Astra/high coordinator | 1 | 18,702,395 | 18,398,848 | 38,611 | 92.8% |
| Sol/high inspection and reviews | 5 | 1,262,056 | 1,095,424 | 14,522 | 5.5% |
| Luna/max workers | 3 | 7,258,779 | 6,977,024 | 52,804 | 1.0% |
| Attempted Astra/high review | 1 | 21,139 | 7,808 | 142 | 0.6% |

Rates used per million uncached input / cached input / output tokens: Astra
250 / 25 / 1,250 credits; Sol 100 / 10 / 500; Luna 5 / 0.5 / 30.
Formula: `((input - cached) * inputRate + cached * cacheRate + output * outputRate) / 1e6`.
OpenAI documents that model choice, session length, context, and tool use affect
allowance consumption, and that local reviews consume general usage.
Source: [official Codex pricing](https://learn.chatgpt.com/docs/pricing),
consulted 2026-09-09.

## ContextSpace's contribution

The [cost-aware workflow](../../resources/workflows/cost-aware-sol-luna.md)
explicitly describes itself as advisory. It cannot enforce the harness model
or meter its usage. Its role table omits a separate coordinator default, calls
for Luna/max even on small implementation tasks, and requires a fresh review
after each builder pass. Those instructions can amplify coordination overhead.
They also already discourage broad dumps and require a finite safety guard;
those protections were insufficiently effective in this session.

The actual session used Codex native collaboration, with `codex-tui` as its
originator. ContextSpace's separate runtime orchestrator has a pipeline that
accumulates previous phase output, but that is not evidence that it drove
these native agent calls. No causal attribution to that runtime is justified.

The assistant contributed avoidable overhead by keeping the coordinator on
Astra, applying multiple planning/review passes to backlog documentation,
polling frequently, and bringing large tool outputs into context. Cheaper
workers alone did not make the overall process cheap.

## Recommended next steps

Before resuming implementation, use a cheaper main session with a concise
handoff. Retain Luna for bounded work and reserve the more expensive model for
a scoped review. Treat lower effort for trivial tasks as a proposed change to
the current max-effort preference, not an already applied setting.

Use one worker per coherent change, concise evidence, targeted file reads,
and completion notifications instead of repeated short polling. Review the
complete small change; avoid separate agent cycles for clerical updates.

The backlog now records three proposed workflow improvements: an explicit
coordinator model check, proportional review/effort guidance, and usage
visibility that includes the parent session. Product implementation and model
configuration remain unchanged by this investigation.
