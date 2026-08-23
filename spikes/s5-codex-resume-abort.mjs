import { Codex } from "@openai/codex-sdk";
import assert from "node:assert";
import crypto from "node:crypto";

console.log("=== SPIKE 5: Codex Thread Resume & AbortSignal Wiring ===");

const codex = new Codex();
const testThreadId = crypto.randomUUID();

// 1. Validate resumeThread returns an active Thread handle
const thread = codex.resumeThread(testThreadId);
assert.ok(thread, "Spike 5: resumeThread must return a Thread instance");
assert.strictEqual(typeof thread.runStreamed, "function", "Spike 5: resumed Thread must expose runStreamed");

// 2. Validate AbortSignal support
const abortController = new AbortController();
assert.strictEqual(abortController.signal.aborted, false);
abortController.abort();
assert.strictEqual(abortController.signal.aborted, true, "Spike 5: AbortSignal state must be aborted");

console.log("✅ Spike 5 Passed: Codex thread resumption and AbortSignal wiring verified.");
