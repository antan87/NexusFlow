import { EventEmitter } from 'node:events';
import OpenAI from 'openai';
import fs from 'fs-extra';
import path from 'node:path';

export class NativeAgent extends EventEmitter {
  private abortController: AbortController | null = null;
  private openai: OpenAI;
  private messages: any[] = [];
  private cwd: string = '';
  private isProcessing: boolean = false;
  private modelName: string;

  constructor() {
    super();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || ''
    });
    this.modelName = process.env.OPENAI_MODEL || 'gpt-4o';
  }

  public async start(cwd: string) {
    this.cwd = cwd;
    this.messages = [
      {
        role: 'system',
        content: `You are an expert coding assistant running within the NexusFlow IDE.
You have read-only access to the user's workspace at ${cwd} through your tools: you can read files and list directories, but you cannot edit files or run commands.
When suggesting code changes, include the proposed diff directly in your text response so the user can apply it themselves.`
      }
    ];
  }

  public async send(data: string) {
    if (this.isProcessing) return;
    await this.runLoop(data);
  }

  private async runLoop(userInput: string) {
    this.abortController = new AbortController();
    this.isProcessing = true;
    const self = this;

    this.messages.push({ role: 'user', content: userInput });

    try {
      const tools = [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read the contents of a file',
            parameters: {
              type: 'object',
              properties: {
                filePath: { type: 'string', description: 'Path to file relative to workspace' }
              },
              required: ['filePath']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'list_directory',
            description: 'List the contents of a directory',
            parameters: {
              type: 'object',
              properties: {
                dirPath: { type: 'string', description: 'Path to directory relative to workspace' }
              },
              required: ['dirPath']
            }
          }
        }
      ];

      let completed = false;

      for (let step = 0; step < 5; step++) {
        if (this.abortController.signal.aborted) break;

        const stream: any = await this.openai.chat.completions.create({
          model: this.modelName,
          messages: this.messages,
          tools: tools as any,
          stream: true
        }, { signal: this.abortController.signal });

        let content = '';
        let toolCalls: any[] = [];

        for await (const chunk of stream) {
          const delta: any = (chunk as any).choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            content += delta.content;
            self.emit('data', delta.content);
          }

          if (delta.tool_calls) {
            for (const toolCall of (delta.tool_calls as any)) {
              const index = toolCall.index;
              if (!toolCalls[index]) {
                toolCalls[index] = {
                  id: toolCall.id,
                  type: 'function',
                  function: { name: toolCall.function?.name, arguments: '' }
                };
                self.emit('data', `\n\n*Running tool: ${toolCall.function?.name}*\n`);
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
          break; // Done with loop
        }

        // Handle tool calls
        for (const tc of toolCalls) {
          try {
            const args = JSON.parse(tc.function.arguments);
            let result = '';
            
            if (tc.function.name === 'read_file') {
              const absolutePath = path.join(this.cwd, args.filePath);
              result = await fs.readFile(absolutePath, 'utf8');
            } else if (tc.function.name === 'list_directory') {
              const absolutePath = path.join(this.cwd, args.dirPath);
              result = (await fs.readdir(absolutePath)).join('\n');
            }

            this.messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.function.name,
              content: result
            });
          } catch (err: any) {
             this.messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.function.name,
              content: `Error: ${err.message}`
            });
          }
        }
      }

      if (!completed && !this.abortController.signal.aborted) {
        self.emit('data', '\n\n*Stopped after reaching the tool-step limit without a final answer. Send a follow-up message to continue.*\n');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('NativeAgent error:', err);
        self.emit('error', err);
      }
    } finally {
      this.isProcessing = false;
      this.emit('idle');
    }
  }

  public stop() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.emit('close', 0);
  }
}
