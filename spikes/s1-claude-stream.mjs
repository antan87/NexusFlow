import { query } from "@anthropic-ai/claude-agent-sdk";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import assert from "node:assert";

console.log("=== SPIKE 1: Claude Init Timing + Deltas + Env Semantics ===");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-spike-1-"));
let initReceived = false;
let initReceivedFirst = false;
let firstEvent = null;
let capturedSessionId = null;

try {
  const q = query({
    prompt: "echo probe",
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
    if (!firstEvent) {
      firstEvent = msg;
      if (msg.type === "system" && msg.subtype === "init") {
        initReceivedFirst = true;
      }
    }
    if (msg.type === "system" && msg.subtype === "init") {
      initReceived = true;
      capturedSessionId = msg.session_id;
      console.log("[Spike 1] Init event captured:", {
        type: msg.type,
        subtype: msg.subtype,
        session_id: msg.session_id,
        cwd: msg.cwd,
      });
      break; // Init timing validated immediately
    }
  }
} catch (err) {
  // If API authentication fails at execution, init message was still captured first
  console.log("[Spike 1] Subprocess exited:", err.message);
} finally {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

// Assertions
assert.strictEqual(initReceived, true, "Spike 1: system:init MUST be received");
assert.strictEqual(initReceivedFirst, true, "Spike 1: system:init MUST be the first event emitted");
assert.ok(capturedSessionId && typeof capturedSessionId === "string", "Spike 1: session_id must be a valid string");

// SDK Inspection on Env Semantics:
const sdkCode = fs.readFileSync(
  path.resolve("node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs"),
  "utf8"
);
const envReplacesPattern = /xn\s*=\s*ne\s*\?\s*\{\s*\.\.\.ne\s*\}\s*:\s*\{\s*\.\.\.process\.env\s*\}/;
const hasEnvReplace = envReplacesPattern.test(sdkCode);
assert.strictEqual(hasEnvReplace, true, "Spike 1: SDK code MUST match replace semantics (ne ? {...ne} : {...process.env})");

console.log("✅ Spike 1 Passed: init arrives first with session_id, and SDK env replace semantics verified.");
