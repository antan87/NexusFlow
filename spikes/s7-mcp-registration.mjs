import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import assert from "node:assert";

console.log("=== SPIKE 7: MCP Tool Registration Across Harnesses ===");

// 1. Validate Claude Agent SDK MCP Server registration
const testServer = createSdkMcpServer({
  name: "nexusflow-test-server",
  version: "1.0.0",
  tools: [
    tool(
      "list_workspaces",
      "List all active NexusFlow workspaces",
      {
        filter: z.string().optional(),
      },
      async (args) => {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify([{ id: "ws-1", name: "default" }]),
            },
          ],
        };
      }
    ),
  ],
});

assert.ok(testServer, "Spike 7: createSdkMcpServer must instantiate valid McpServer");
assert.ok(testServer.instance, "Spike 7: McpServer instance must be present");

console.log("✅ Spike 7 Passed: MCP Server registration verified on Claude Agent SDK.");
