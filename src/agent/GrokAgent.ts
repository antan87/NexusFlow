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

/**
 * xAI's Grok over its OpenAI-compatible API.
 *
 * xAI serves the OpenAI chat-completions shape at its own base URL, so the
 * streaming loop is `NativeAgent`'s with two differences: the credential is
 * `XAI_API_KEY` rather than `OPENAI_API_KEY`, and the base URL is xAI's. The
 * base URL is passed explicitly rather than left to the SDK's `OPENAI_BASE_URL`
 * environment variable, so configuring a different OpenAI-compatible gateway
 * cannot silently redirect Grok traffic somewhere else.
 */
export class GrokAgent extends NativeAgentBase {
  protected readonly label = 'GrokAgent';
  private openai: OpenAI | null = null;
  private messages: any[] = [];
  private modelName: string;

  constructor() {
    super();
    // Resolved per turn in runLoop: the model can be chosen in chat settings,
    // which start() only learns after construction.
    this.modelName = this.resolveModel('grok-4', 'XAI_MODEL');
  }

  private client(): OpenAI {
    this.openai ??= new OpenAI({
      apiKey: process.env.XAI_API_KEY || '',
      baseURL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
    });
    return this.openai;
  }

  protected configError(): string | null {
    return process.env.XAI_API_KEY ? null : 'xAI API key is not configured (set XAI_API_KEY).';
  }

  protected resetHistory() {
    this.messages = [{ role: 'system', content: buildSystemPrompt(this.cwd) }];
  }

  protected async runLoop(userInput: string, signal: AbortSignal) {
    // The session is supplied by start(), after construction.
    this.modelName = this.resolveModel('grok-4', 'XAI_MODEL');
    this.messages.push({ role: 'user', content: userInput });

    const mcp = await this.mcpTools();
    if (mcp.length > 0) {
      this.emit('data', `\n\n*Connected to the workspace MCP server (${mcp.length} tool${mcp.length === 1 ? '' : 's'})*\n`);
    }
    const tools = [
      ...NATIVE_TOOLS.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: { [tool.argName]: { type: 'string', description: tool.argDescription } },
            required: [tool.argName],
          },
        },
      })),
      ...mcp.map(mcpToolSchema),
    ];

    let completed = false;

    for (let step = 0; step < NATIVE_STEP_LIMIT; step++) {
      if (signal.aborted) break;

      const stream: any = await this.client().chat.completions.create(
        { model: this.modelName, messages: this.messages, tools: tools as any, stream: true },
        { signal },
      );

      let content = '';
      const toolCalls: any[] = [];

      for await (const chunk of stream) {
        const delta: any = (chunk as any).choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          this.emit('data', delta.content);
        }

        for (const toolCall of (delta.tool_calls ?? [])) {
          const index = toolCall.index ?? 0;
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

      this.messages.push({
        role: 'assistant',
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      if (toolCalls.length === 0) {
        completed = true;
        break;
      }

      const byName = new Map(mcp.map((tool) => [tool.name, tool]));
      for (const call of toolCalls) {
        const name = call.function?.name;
        const remote = byName.get(name);
        let result: string;
        try {
          const args = JSON.parse(call.function?.arguments || '{}');
          result = remote ? await remote.call(args) : await executeNativeTool(this.cwd, name, args);
        } catch (error: any) {
          result = `Error: ${error?.message}`;
        }
        this.messages.push({ role: 'tool', tool_call_id: call.id, name, content: result });
      }
    }

    if (!completed && !signal.aborted) {
      this.emit('data', STEP_LIMIT_NOTICE);
    }
  }
}
