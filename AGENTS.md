# sdk_claude_codex

## Feature Goal: First-Party SDK Integration & Compatibility (Claude Agent SDK + Codex SDK)

Both harnesses ship first-party SDKs, with an abstraction layer (AI SDK Harnesses) normalizing them. NexusFlow integrates with both SDKs to replace CLI shelling/scraping with programmable, observable session orchestration.

---

### SDK Reference & Implementation Details

#### 1. Claude Code → Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` >= 0.3.234)

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: "Review the API changes across all repos",
  options: {
    cwd: "~/dev/workspaces/feature/user-auth", // workspace root
    additionalDirectories: ["my-api", "my-frontend"], // per-repo access
    permissionMode: "acceptEdits",
    resume: sessionId,          // ← programmatic session resume
    forkSession: isRetry,       // ← fork on retry to preserve audit log
    mcpServers: { /* nexusflow MCP server */ },
  },
  env: {
    CLAUDE_CODE_PROJECT_DIR_NAME: workspaceId,
    CLAUDE_CONFIG_DIR: claudeConfigDir,
  },
});

for await (const msg of q) {
  // Session ID capture: session_id is mid-stream on init SystemMessage and ResultMessage
  if (msg.type === "system" && msg.subtype === "init") {
    await nexusflow.sessions.upsert({ claudeId: msg.session_id, workspaceId, status: "running" });
  }
}
```

* **Session ID Capture Timing:** `session_id` lands mid-stream on the `init` `SystemMessage` (and is present on all `ResultMessage`s including errors). Create/upsert DB session rows lazily upon receiving `init`.
* **`sessionStore` CWD-Coupling Fix:** The store's `projectKey` is derived from working directory. To support ephemeral/multi-host workspaces, set `CLAUDE_CODE_PROJECT_DIR_NAME` (+ `CLAUDE_CONFIG_DIR`) in the query's `env` to key entries by NexusFlow workspace ID instead of a path hash. Pin `@anthropic-ai/claude-agent-sdk >= 0.3.234`. Key store records by `(workspaceId, sessionId)`.
* **Eliminate JSONL Scraping:** `sessionStore` handles `listSessions()`, `getSessionInfo()`, `getSessionMessages()`, `renameSession()`, `tagSession()`, `deleteSession()`, `forkSession()`, `listSubagents()`, and `getSubagentMessages()`. Use `InMemorySessionStore` in dev and Postgres/S3 adapter in prod.
* **`forkSession` Custom Store Constraint & Semantics:**
  * Forking is not a raw byte-copy — the SDK rewrites `sessionId` fields and message UUIDs, appending under a new key. Custom store adapters must expose granular entry-level read/write (not blob get/put).
  * **Semantic Trap:** Forks branch conversation history only — file edits are shared and real. For alternative approach exploration in Teamwork Strategy, pair `forkSession` with file checkpointing or fresh worktrees.
  * Use `forkSession: true` with `resume` when a user hits "retry with different instructions" to avoid mutating historical transcripts.
* **Hooks & `canUseTool`:** Intercept tool calls to power approval states (status dots) in the UI.

#### 2. Codex → Codex SDK (`@openai/codex-sdk`)

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex({ config: { sandbox_workspace_write: { network_access: true } } });
const thread = codex.startThread({ skipGitRepoCheck: true });
const stream = thread.runStreamed("Diagnose failing test", { outputSchema });

for await (const event of stream) {
  if (event.type === "item.completed") {
    // feed straight into dashboard log panel
    dashboard.appendLog(event.item);
  }
  if (event.type === "turn.completed") {
    // capture usage in schema early for normalized token tracking
    metrics.recordUsage(event.usage);
  }
}

// Resume thread directly from ~/.codex/sessions without CLI shelling
const resumed = codex.resumeThread(savedThreadId);
```

* **`skipGitRepoCheck`:** Codex fails if `workingDirectory` is not a Git repo. In multi-repo workspace roots, pass `skipGitRepoCheck: true` on `startThread()` or target individual repo roots.
* **Stream Event Mapping:**
  * Map `item.completed` events directly to dashboard log entries.
  * Map `turn.completed` events to capture `event.usage` immediately to align normalized token usage schema across both harnesses.
* **Skills Injection:** Codex reads `AGENTS.md` natively, but does not auto-discover skill directories; skills require inline injection when needed.

---

### Pre-Sprint Validation Spikes (Half-Day Empirical Checklist)

Before Phase 1 implementation, run targeted empirical spikes to validate core runtime claims:

1. **Lazy `session_id` capture:** Spawn query → assert `init` message yields ID before any other output.
2. **Cross-host resume:** Terminate mid-session → resume in fresh cwd with `CLAUDE_CODE_PROJECT_DIR_NAME` set → assert conversation history is preserved.
3. **Custom-store fork:** `forkSession` against `InMemorySessionStore` → assert new key + remapped message UUIDs.
4. **Codex non-git root:** `startThread({ skipGitRepoCheck: true })` in a plain directory without git initialization.
5. **Codex restart resume:** `resumeThread(id)` from a brand-new process → assert context retained.
6. **Usage normalization:** Assert `turn.completed.usage` populated → map into normalized usage schema.
7. **MCP registration:** Both harnesses enumerate NexusFlow's MCP tools.

---

### Implementation Phases & Acceptance Criteria

| Phase | Description | Acceptance Criteria (Done When) |
|---|---|---|
| **Phase 1** | First-Party SDK Integration, `HarnessAdapter` Core & Native Resumption | Single internal `HarnessAdapter` interface defined with normalized session/thread/event/usage types and typed escape hatch (`nativeOptions?: unknown`); zero clipboard/CLI-shell paths remain; Claude session resumes cross-host via `sessionStore` with `CLAUDE_CODE_PROJECT_DIR_NAME`; Codex thread resumes after process restart; token usage captured for both. |
| **Phase 2** | NexusFlow MCP Server | Both harnesses can complete a full loop (create workspace → list repos → tail log) without human dashboard action; scoped tool surfaces (allow/deny lists) enforced per agent role (e.g. read-only CI vs interactive write behind `canUseTool`). |
| **Phase 3** | Multi-Agent Orchestration & Contract Test Suite | Full contract test suites pass per engine; Teamwork Strategy workflow runs ≥2 isolated agents with independent session/thread IDs (**Claude:** native programmatic subagents; **Codex:** orchestrator-level thread fan-out). |

---

### Architecture & Operational Policies

* **`HarnessAdapter` Architecture & Subagent Asymmetry:**
  * Define normalized session, thread, event, and usage types in Phase 1 and implement both engines behind it from day one.
  * Include a typed escape hatch (`nativeOptions?: unknown`) on the adapter interface to accommodate frequent vendor SDK updates without blocking on abstraction updates.
  * **Subagent Asymmetry:**
    * **Claude Agent SDK:** First-class programmatic subagents (`define agents`, per-subagent tools/models/permissions, inspectable via `listSubagents()` / `getSubagentMessages()` in `sessionStore`).
    * **Codex SDK:** No first-class subagent primitives — subagents must be orchestrated as multiple NexusFlow-managed threads.
  * The AI SDK Harness contract (`@ai-sdk/harness-claude-code`, `@ai-sdk/harness-codex`) is evaluated behind NexusFlow's internal `HarnessAdapter` interface to keep public type surfaces stable across vendor churn.

* **Operational Policies:**
  * **Orphaned Session Reconciliation:** Run a startup sweep on backend initialization to mark lingering "running" DB session rows as interrupted and surface a direct "resume?" action in the UI.
  * **Concurrent Mutation Policy:** Enforce per-workspace mutation locking for single-worktree sessions, or require mandatory worktree/branch isolation for multi-agent workflows to prevent file clobbering.
  * **SessionStore Failure Mode:** Fail-fast on store write errors mid-turn with explicit turn failure rather than silent fallback, preventing divergence between stored history and reality.
  * **Usage & Billing Representation:** `costUsdEstimate` is a client-side estimate computed from bundled tables (never authoritative for chargeback). Derive `BillingMode = "per-token" | "plan-included"`; dashboard suppresses or labels dollar figures as "est." for subscription sessions while rendering token counts prominently.
  * **Subscription Quota Visibility & Remediation:** Keyless/subscription sessions (Claude Pro/Max, ChatGPT sign-in) lack in-stream percentage quota metrics; quota exhaustion manifests as mid-session turn failures. On `turn_failed` rate/window limit errors, render actionable remediation guidance (wait for reset / enable API credits / switch auth).
  * **Version Drift Automation:** Pin exact package versions (`@anthropic-ai/claude-agent-sdk >= 0.3.234`, `@openai/codex-sdk`) and wire contract test suites into CI against Dependabot/Renovate PRs.

---

## Repos

| Repo | Directory | Verify | Cross-repo |
|---|---|---|---|
| `NexusFlow` | `NexusFlow` | `npm test` | — |

Each repo above is a separate git worktree on `sdk_claude_codex`. **Do not edit the original repositories elsewhere on disk** — that is a different checkout and changes there are not part of this feature.

## Where to look

- `nexusflow-knowledge.md` — decisions and gotchas from earlier sessions, one per `###` heading. It grows every session and is often long, so search the headings for your topic and read only those entries, not the whole file. Add with `nexusflow knowledge add -t decision|gotcha -m "..."`, keeping each entry to a rule and its reason
- `nexusflow-plan.md` — phase order when a change spans repos

---

## Codex-Specific Notes

- Each project subdirectory may contain its own `AGENTS.md` or
  `AGENTS.override.md` with module-specific context.
- When working in a subdirectory, check for local overrides before
  applying workspace-level guidance.
- Use `codex --approval-mode suggest` for cross-repo changes to
  review each change before applying.
