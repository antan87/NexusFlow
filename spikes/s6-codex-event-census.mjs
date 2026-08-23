import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert";

console.log("=== SPIKE 6: Codex Event Census & Item Type Inventory ===");

// Read index.d.ts to extract and assert canonical type definitions
const typesDts = fs.readFileSync(
  path.resolve("node_modules/@openai/codex-sdk/dist/index.d.ts"),
  "utf8"
);

// Assert ThreadEvent union constituents
const expectedEvents = [
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "item.started",
  "item.updated",
  "item.completed",
  "error",
];

for (const evName of expectedEvents) {
  assert.ok(
    typesDts.includes(`"${evName}"`),
    `Spike 6: Codex SDK must define event type "${evName}"`
  );
}

// Assert ThreadItem union constituents
const expectedItems = [
  "agent_message",
  "file_change",
  "command_execution",
  "mcp_tool_call",
  "reasoning",
  "web_search",
  "todo_list",
  "error",
];

for (const itemName of expectedItems) {
  assert.ok(
    typesDts.includes(`type: "${itemName}"`),
    `Spike 6: Codex SDK must define item type "${itemName}"`
  );
}

// Assert Usage schema
const expectedUsageFields = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
];

for (const field of expectedUsageFields) {
  assert.ok(
    typesDts.includes(`${field}: number`),
    `Spike 6: Codex Usage schema must contain "${field}"`
  );
}

// Assert no text_delta event exists in Codex (item-atomic)
assert.strictEqual(
  typesDts.includes('"text_delta"'),
  false,
  "Spike 6: Codex SDK does not have text_delta event (agent_message is item-atomic)"
);

console.log("✅ Spike 6 Passed: Complete Codex Event Census and Item Inventory verified.");
