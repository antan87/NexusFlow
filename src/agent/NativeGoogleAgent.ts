import { GoogleGenAI } from '@google/genai';
import { NativeAgentBase } from './NativeAgentBase.js';
import {
  NATIVE_TOOLS,
  NATIVE_STEP_LIMIT,
  STEP_LIMIT_NOTICE,
  buildSystemPrompt,
  executeNativeTool,
} from './nativeTools.js';

/**
 * JSON Schema from an MCP server, in the shape Gemini's function declarations
 * expect: the same type vocabulary in upper case, applied recursively because a
 * nested object property is as valid in a workspace tool as a top-level one.
 */
function toGeminiSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const convert = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(convert);
    if (!node || typeof node !== 'object') return node;
    const source = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (key === 'type' && typeof value === 'string') out[key] = value.toUpperCase();
      else if (key === 'properties' && value && typeof value === 'object') {
        out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, convert(child)]));
      } else out[key] = convert(value);
    }
    return out;
  };
  return (convert(schema ?? { type: 'object', properties: {} }) ?? {}) as Record<string, unknown>;
}

export class NativeGoogleAgent extends NativeAgentBase {
  protected readonly label = 'NativeGoogleAgent';
  private ai: GoogleGenAI | null = null;
  private history: any[] = [];
  private modelName: string;

  constructor() {
    super();
    // Resolved per turn in runLoop: the model can be chosen in chat settings,
    // which start() only learns after construction.
    this.modelName = this.resolveModel('gemini-2.0-flash', 'GEMINI_MODEL');
  }

  private client(): GoogleGenAI {
    return (this.ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' }));
  }

  protected configError(): string | null {
    return process.env.GEMINI_API_KEY ? null : 'Google API key is not configured (set GEMINI_API_KEY).';
  }

  protected resetHistory() {
    this.history = [];
  }

  protected async runLoop(userInput: string, signal: AbortSignal) {
    // The session is supplied by start(), after construction.
    this.modelName = this.resolveModel('gemini-2.0-flash', 'GEMINI_MODEL');
    this.history.push({ role: 'user', parts: [{ text: userInput }] });

    // Same gap as the other native agents: a generated .mcp.json was never read,
    // because a native provider brings no MCP client of its own.
    const mcp = await this.mcpTools();
    if (mcp.length > 0) {
      this.emit('data', `\n\n*Connected to the workspace MCP server (${mcp.length} tools)*\n`);
    }
    const config: any = {
      systemInstruction: buildSystemPrompt(this.cwd),
      // Cancels an in-flight request when stop() aborts the controller.
      abortSignal: signal,
      tools: [{
        functionDeclarations: [
          ...NATIVE_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: {
              type: 'OBJECT',
              properties: { [t.argName]: { type: 'STRING', description: t.argDescription } },
              required: [t.argName],
            },
          })),
          ...mcp.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: toGeminiSchema(tool.inputSchema),
          })),
        ],
      }],
    };

    let completed = false;

    for (let step = 0; step < NATIVE_STEP_LIMIT; step++) {
      if (signal.aborted) break;

      const responseStream = await this.client().models.generateContentStream({
        model: this.modelName,
        contents: this.history,
        config,
      });

      let fullText = '';
      const functionCalls: any[] = [];

      for await (const chunk of responseStream) {
        if (chunk.text) {
          fullText += chunk.text;
          this.emit('data', chunk.text);
        }
        if (chunk.functionCalls && chunk.functionCalls.length > 0) {
          functionCalls.push(...chunk.functionCalls);
        }
      }

      const modelParts: any[] = [];
      if (fullText) modelParts.push({ text: fullText });
      if (functionCalls.length > 0) modelParts.push(...functionCalls.map((fc) => ({ functionCall: fc })));
      this.history.push({ role: 'model', parts: modelParts });

      if (functionCalls.length === 0) {
        completed = true;
        break;
      }

      const functionResponses: any[] = [];
      const byName = new Map(mcp.map((tool) => [tool.name, tool]));
      for (const call of functionCalls) {
        this.emit('data', `\n\n*Running tool: ${call.name}*\n`);
        const remote = byName.get(call.name);
        let result: string;
        try {
          result = remote ? await remote.call((call.args ?? {}) as Record<string, unknown>) : await executeNativeTool(this.cwd, call.name, call.args || {});
        } catch (e: any) {
          result = `Error: ${e?.message}`;
        }
        functionResponses.push({ functionResponse: { name: call.name, response: { result } } });
      }

      this.history.push({ role: 'user', parts: functionResponses });
    }

    if (!completed && !signal.aborted) {
      this.emit('data', STEP_LIMIT_NOTICE);
    }
  }
}
