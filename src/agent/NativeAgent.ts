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

  constructor() {
    super();
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || ''
    });
  }

  public async start(prompt: string | undefined, cwd: string) {
    this.cwd = cwd;
    this.messages = [
      {
        role: 'system',
        content: `You are an expert coding assistant running within the NexusFlow IDE. 
You have access to the user's workspace at ${cwd}.
Use your tools to read files, run tests, and propose code changes.
When proposing changes, output the diff directly in your text response.`
      }
    ];

    if (prompt) {
      await this.runLoop(prompt);
    }
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

      for (let step = 0; step < 5; step++) {
        if (this.abortController.signal.aborted) break;

        const stream: any = await this.openai.chat.completions.create({
          model: 'gpt-4o',
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
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('NativeAgent error:', err);
        self.emit('error', err);
      }
    } finally {
      this.isProcessing = false;
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
