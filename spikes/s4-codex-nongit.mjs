import { Codex } from "@openai/codex-sdk";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import assert from "node:assert";

console.log("=== SPIKE 4: Codex Plain Non-Git Working Directory ===");

const plainTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-spike-4-"));
assert.strictEqual(fs.existsSync(path.join(plainTmpDir, ".git")), false, "Spike 4: Directory must NOT be a git repo");

try {
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: plainTmpDir,
    skipGitRepoCheck: true,
  });

  assert.ok(thread, "Spike 4: startThread must return a valid Thread instance");
  assert.strictEqual(typeof thread.runStreamed, "function", "Spike 4: Thread must expose runStreamed function");
  assert.strictEqual(typeof thread.run, "function", "Spike 4: Thread must expose run function");
  console.log("✅ Spike 4 Passed: Codex thread initialized in non-git directory with skipGitRepoCheck: true.");
} finally {
  try {
    fs.rmSync(plainTmpDir, { recursive: true, force: true });
  } catch {}
}
