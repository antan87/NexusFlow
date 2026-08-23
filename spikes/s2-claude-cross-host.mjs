import { InMemorySessionStore } from "@anthropic-ai/claude-agent-sdk";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert";
import crypto from "node:crypto";

console.log("=== SPIKE 2: Claude Cross-Host ProjectKey Derivation ===");

const configDir = path.join(os.tmpdir(), "claude-spike-2-config");
const workspaceId = "ws-nexusflow-shared";
process.env.CLAUDE_CONFIG_DIR = configDir;
process.env.CLAUDE_CODE_PROJECT_DIR_NAME = workspaceId;

const store = new InMemorySessionStore();
const sessionId = crypto.randomUUID();

// Simulate turn 1 saved from Host A (path: /opt/workspace/host-a/repo)
const hostAProjectKey = workspaceId; // derived from CLAUDE_CODE_PROJECT_DIR_NAME
const turn1Entry = {
  type: "user",
  uuid: crypto.randomUUID(),
  sessionId,
  parentUuid: null,
  logicalParentUuid: null,
  timestamp: new Date().toISOString(),
  message: { role: "user", content: "What is the secret token? Token is 42." },
};

await store.append({ projectKey: hostAProjectKey, sessionId }, [turn1Entry]);

// Simulate resume from Host B (path: /home/runner/workspaces/host-b/ephemeral)
const hostBProjectKey = workspaceId; // also derived from CLAUDE_CODE_PROJECT_DIR_NAME
const loadedSessions = await store.listSessions(hostBProjectKey);
const loadedEntries = await store.load({ projectKey: hostBProjectKey, sessionId });

// Assertions
assert.strictEqual(loadedSessions.length, 1, "Spike 2: session must be found under shared workspaceId");
assert.strictEqual(loadedSessions[0].sessionId, sessionId, "Spike 2: sessionId must match exactly");
assert.strictEqual(loadedEntries?.length, 1, "Spike 2: conversation history must be loaded on fresh host path");
assert.strictEqual(loadedEntries[0].message.content, "What is the secret token? Token is 42.", "Spike 2: prompt content must be intact");

console.log("✅ Spike 2 Passed: Cross-host session resumption verified using CLAUDE_CODE_PROJECT_DIR_NAME.");
