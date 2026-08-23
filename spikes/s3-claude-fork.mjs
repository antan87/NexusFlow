import { InMemorySessionStore, forkSession } from "@anthropic-ai/claude-agent-sdk";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert";
import crypto from "node:crypto";

console.log("=== SPIKE 3: Custom-Store Fork & UUID Remapping ===");

// Portable temp config directory across Linux, macOS, and Windows
const configDir = path.join(os.tmpdir(), "claude-spike-3-config");
const workspaceId = "ws-fork-test";
process.env.CLAUDE_CONFIG_DIR = configDir;
process.env.CLAUDE_CODE_PROJECT_DIR_NAME = workspaceId;

const store = new InMemorySessionStore();
const projectKey = workspaceId;

const sourceSessionId = crypto.randomUUID();
const entry1Uuid = crypto.randomUUID();
const entry2Uuid = crypto.randomUUID();

const entry1 = {
  type: "user",
  uuid: entry1Uuid,
  sessionId: sourceSessionId,
  parentUuid: null,
  logicalParentUuid: null,
  timestamp: new Date().toISOString(),
  message: { role: "user", content: "Initial turn prompt" },
};
const entry2 = {
  type: "assistant",
  uuid: entry2Uuid,
  sessionId: sourceSessionId,
  parentUuid: entry1Uuid,
  logicalParentUuid: entry1Uuid,
  timestamp: new Date().toISOString(),
  message: { role: "assistant", content: [{ type: "text", text: "Assistant response" }] },
};

await store.append({ projectKey, sessionId: sourceSessionId }, [entry1, entry2]);

const sourceBefore = await store.load({ projectKey, sessionId: sourceSessionId });
assert.strictEqual(sourceBefore?.length, 2, "Spike 3: Source session must contain 2 entries before fork");

const result = await forkSession(sourceSessionId, {
  sessionStore: store,
});

const targetSessionId = result.sessionId;
const forkedEntries = await store.load({ projectKey, sessionId: targetSessionId });
const sourceAfter = await store.load({ projectKey, sessionId: sourceSessionId });

// Strict Assertions
assert.ok(targetSessionId && targetSessionId !== sourceSessionId, "Spike 3: targetSessionId must be a newly allocated UUID");
assert.strictEqual(sourceAfter?.length, 2, "Spike 3: Original source session entries MUST be untouched");
assert.ok(forkedEntries && forkedEntries.length >= 2, "Spike 3: Target session must contain the forked entries");
assert.strictEqual(forkedEntries[0].sessionId, targetSessionId, "Spike 3: Entry 0 sessionId must be rewritten to targetSessionId");
assert.notStrictEqual(forkedEntries[0].uuid, entry1Uuid, "Spike 3: Entry 0 UUID must be remapped to a fresh UUID");
assert.strictEqual(forkedEntries[1].parentUuid, forkedEntries[0].uuid, "Spike 3: Entry 1 parentUuid must point to remapped Entry 0 UUID");
assert.ok(forkedEntries[0].forkedFrom, "Spike 3: forkedFrom lineage metadata must be present");
assert.strictEqual(forkedEntries[0].forkedFrom.sessionId, sourceSessionId, "Spike 3: forkedFrom.sessionId must reference sourceSessionId");
assert.strictEqual(forkedEntries[0].forkedFrom.messageUuid, entry1Uuid, "Spike 3: forkedFrom.messageUuid must reference original message UUID");

console.log("✅ Spike 3 Passed: Custom-store fork granular entry remapping & lineage verified.");
