import { InMemorySessionStore, forkSession } from "@anthropic-ai/claude-agent-sdk";
import crypto from "node:crypto";

console.log("=== SPIKE 3: Custom-Store Fork & UUID Remapping ===");

// Set BOTH CLAUDE_CONFIG_DIR and CLAUDE_CODE_PROJECT_DIR_NAME
process.env.CLAUDE_CONFIG_DIR = "C:/tmp/.claude";
process.env.CLAUDE_CODE_PROJECT_DIR_NAME = "ws-test-project";

const store = new InMemorySessionStore();
const projectKey = "ws-test-project";

const sourceSessionId = crypto.randomUUID();
const entry1Uuid = crypto.randomUUID();
const entry2Uuid = crypto.randomUUID();

// Populate valid entries with required fields
const entry1 = {
  type: "user",
  uuid: entry1Uuid,
  sessionId: sourceSessionId,
  parentUuid: null,
  logicalParentUuid: null,
  timestamp: new Date().toISOString(),
  message: { role: "user", content: "Initial turn prompt" }
};
const entry2 = {
  type: "assistant",
  uuid: entry2Uuid,
  sessionId: sourceSessionId,
  parentUuid: entry1Uuid,
  logicalParentUuid: entry1Uuid,
  timestamp: new Date().toISOString(),
  message: { role: "assistant", content: [{ type: "text", text: "Assistant response" }] }
};

await store.append({ projectKey, sessionId: sourceSessionId }, [entry1, entry2]);

console.log("Source entries before fork:", (await store.load({ projectKey, sessionId: sourceSessionId }))?.length);

try {
  const result = await forkSession(sourceSessionId, {
    sessionStore: store,
  });

  console.log("\nforkSession returned result:", result);
  const targetSessionId = result.sessionId;
  const forkedEntries = await store.load({ projectKey, sessionId: targetSessionId });
  console.log("Forked entries count:", forkedEntries?.length);
  console.log("Forked entry 1:", forkedEntries?.[0]);
  console.log("Forked entry 2:", forkedEntries?.[1]);

  console.log("\n--- SPIKE 3 VERIFIED CLAIMS ---");
  console.log("1. Original entries untouched?", (await store.load({ projectKey, sessionId: sourceSessionId }))?.length === 2);
  console.log("2. Target session created?", Boolean(forkedEntries));
  console.log("3. Session ID remapped to target?", forkedEntries?.[0]?.sessionId === targetSessionId);
  console.log("4. Message UUID remapped to new UUID?", forkedEntries?.[0]?.uuid !== entry1Uuid && Boolean(forkedEntries?.[0]?.uuid));
  console.log("5. Parent UUID remapped to new parent?", forkedEntries?.[1]?.parentUuid === forkedEntries?.[0]?.uuid);
  console.log("6. forkedFrom metadata recorded?", Boolean(forkedEntries?.[0]?.forkedFrom));
} catch (err) {
  console.error("Spike 3 error:", err);
}
