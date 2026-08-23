import { query } from "@anthropic-ai/claude-agent-sdk";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

console.log("=== SPIKE 1: Claude Init Timing + Deltas + Env Semantics ===");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-spike-1-"));
let initReceivedBeforeAssistant = false;
let assistantReceived = false;
let firstEvent = null;
let deltaEvent = null;

try {
  const q = query({
    prompt: "Respond with a single short sentence confirming receipt and print the value of NEXUS_PROBE.",
    options: {
      cwd: tmpDir,
      includePartialMessages: true,
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      // DECISIVE TEST: do NOT spread process.env.
      env: {
        NEXUS_PROBE: "injected-only",
      },
    },
  });

  for await (const msg of q) {
    if (!firstEvent) firstEvent = msg;
    const preview = JSON.stringify(msg).slice(0, 160);
    console.log(`[${msg.type}${"subtype" in msg ? ":" + msg.subtype : ""}]`, preview);

    if (msg.type === "system" && msg.subtype === "init") {
      if (!assistantReceived) {
        initReceivedBeforeAssistant = true;
      }
    }

    if (msg.type === "stream_event") {
      if (msg.event?.type === "content_block_delta" && msg.event?.delta?.type === "text_delta") {
        if (!deltaEvent) deltaEvent = msg;
      }
    }

    if (msg.type === "assistant") {
      assistantReceived = true;
    }
  }

  console.log("\n--- SPIKE 1 OBSERVATIONS ---");
  console.log("1. Init timing: init received before assistant message?", initReceivedBeforeAssistant);
  console.log("2. First event type:", firstEvent?.type, firstEvent?.subtype);
  console.log("3. Delta event sample:", deltaEvent ? JSON.stringify(deltaEvent) : "None received");
} catch (err) {
  console.error("Spike 1 caught error:", err);
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
