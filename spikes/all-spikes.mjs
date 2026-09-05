import { execSync } from "node:child_process";

console.log("==================================================");
console.log("=== NEXUSFLOW RIGOROUS SPIKE VALIDATION SUITE ===");
console.log("==================================================\n");

const spikeScripts = [
  { id: 1, file: "spikes/s1-claude-stream.mjs", desc: "Claude Init Timing & Env Semantics" },
  { id: 2, file: "spikes/s2-claude-cross-host.mjs", desc: "Claude Cross-Host ProjectKey Derivation" },
  { id: 3, file: "spikes/s3-claude-fork.mjs", desc: "Claude Custom-Store Fork & UUID Remapping" },
  { id: 4, file: "spikes/s4-codex-nongit.mjs", desc: "Codex Non-Git Working Directory" },
  { id: 5, file: "spikes/s5-codex-resume-abort.mjs", desc: "Codex Thread Resume & AbortSignal Wiring" },
  { id: 6, file: "spikes/s6-codex-event-census.mjs", desc: "Codex Event Census & Item Inventory" },
  { id: 7, file: "spikes/s7-mcp-registration.mjs", desc: "MCP Tool Registration" },
];

for (const spike of spikeScripts) {
  console.log(`\n--- Running Spike ${spike.id}: ${spike.desc} ---`);
  try {
    const output = execSync(`node ${spike.file}`, {
      stdio: "pipe",
      encoding: "utf8",
    });
    console.log(output.trim());
    console.log(`[Result] Spike ${spike.id}: ✅ PASSED`);
  } catch (err) {
    console.error(`[Result] Spike ${spike.id}: ❌ FAILED`);
    console.error(err.stdout || err.message);
    process.exit(1);
  }
}

console.log("\n==================================================");
console.log("=== ALL 7 SPIKES COMPLETED WITH PASSING ASSERTIONS ===");
console.log("==================================================");
