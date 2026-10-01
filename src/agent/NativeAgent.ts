import OpenAI from 'openai';
import { NativeAgentBase } from './NativeAgentBase.js';
import {
  NATIVE_TOOLS,
  NATIVE_STEP_LIMIT,
  STEP_LIMIT_NOTICE,
  buildSystemPrompt,
  executeNativeTool,
} from './nativeTools.js';
import { mcpToolSchema } from './nativeMcp.js';

export class NativeAgent extends NativeAgentBase {
  protected readonly label = 'NativeAgent';
  private openai: OpenAI | null = null;
  private messages: any[] = [];
  private modelName: string;

  constructor() {
    super();
    // Resolved per turn in runLoop: the model can be chosen in chat settings,
    // which start() only learns after construction.
    this.modelName = this.resolveModel('gpt-4o', 'OPENAI_MODEL');
  }

  // The OpenAI SDK throws on an empty key, so build the client lazily — after
  // configError() has gated on the key being present.
  private client(): OpenAI {
    return (this.openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' }));
  }

  protected configError(): string | null {
    return process.env.OPENAI_API_KEY ? null : 'OpenAI API key is not configured (set OPENAI_API_KEY).';
  }

  protected resetHistory() {
    this.messages = [{ role: 'system', content: buildSystemPrompt(this.cwd) }];
  }

  protected async runLoop(userInput: string, signal: AbortSignal) {
    // The session is supplied by start(), after construction.
    this.modelName = this.resolveModel('gpt-4o', 'OPENAI_MODEL');
    this.messages.push({ role: 'user', content: userInput });

    // Same gap as the xAI agent: a generated .mcp.json was never read, because a
    // native provider brings no MCP client of its own.
    const mcp = await this.mcpTools();
    if (mcp.length > 0) {
      this.emit('data', `\n\n*Connected to the workspace MCP server (${mcp.length} tools)*\n`);
    }
    const tools = [
      ...NATIVE_TOOLS.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: { [t.argName]: { type: 'string', description: t.argDescription } },
            required: [t.argName],
          },
        },
      })),
      ...mcp.map(mcpToolSchema),
    ];

    let completed = false;

    for (let step = 0; step < NATIVE_STEP_LIMIT; step++) {
      if (signal.aborted) break;

      const stream: any = await this.client().chat.completions.create({
        model: this.modelName,
        messages: this.messages,
        tools: tools as any,
        stream: true,
      }, { signal });

      let content = '';
      const toolCalls: any[] = [];

      for await (const chunk of stream) {
        const delta: any = (chunk as any).choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          this.emit('data', delta.content);
        }

        if (delta.tool_calls) {
          for (const toolCall of (delta.tool_calls as any)) {
            const index = toolCall.index;
            if (!toolCalls[index]) {
              toolCalls[index] = {
                id: toolCall.id,
                type: 'function',
                function: { name: toolCall.function?.name, arguments: '' },
              };
              this.emit('data', `\n\n*Running tool: ${toolCall.function?.name}*\n`);
            }
            if (toolCall.function?.arguments) {
              toolCalls[index].function.arguments += toolCall.function.arguments;
            }
          }
        }
      }

      this.messages.push({ role: 'assistant', content, tool_calls: toolCalls.length > 0 ? toolCalls : undefined });

      if (toolCalls.length === 0) {
        completed = true;
        break;
      }

      const byName = new Map(mcp.map((tool) => [tool.name, tool]));
      for (const tc of toolCalls) {
        const name = tc.function?.name;
        const remote = byName.get(name);
        let result: string;
        try {
          const args = JSON.parse(tc.function?.arguments || '{}');
          result = remote ? await remote.call(args) : await executeNativeTool(this.cwd, name, args);
        } catch (err: any) {
          result = `Error: ${err?.message}`;
        }
        this.messages.push({ role: 'tool', tool_call_id: tc.id, name, content: result });
      }
    }

    if (!completed && !signal.aborted) {
      this.emit('data', STEP_LIMIT_NOTICE);
    }
  }
}
