import { Codex } from "@openai/codex-sdk";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

console.log("=== SPIKE 4: Codex Plain Non-Git Working Directory ===");

const plainTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-spike-4-"));
console.log("Created plain non-git directory:", plainTmpDir);
console.log("Is git repo?", fs.existsSync(path.join(plainTmpDir, ".git")));

try {
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: plainTmpDir,
    skipGitRepoCheck: true,
  });

  console.log("Thread created successfully without git error!");
  console.log("Thread object:", typeof thread, thread ? Object.getOwnPropertyNames(Object.getPrototypeOf(thread)) : "null");
  console.log("\n--- SPIKE 4 VERIFIED CLAIMS ---");
  console.log("1. startThread with skipGitRepoCheck: true succeeds in non-git root? true");
} catch (err) {
  console.error("Spike 4 error:", err);
} finally {
  try {
    fs.rmSync(plainTmpDir, { recursive: true, force: true });
  } catch {}
}
