import { EventEmitter } from 'node:events';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs-extra';
import path from 'node:path';

export class NativeClaudeAgent extends EventEmitter {
  private abortController: AbortController | null = null;
  private anthropic: Anthropic;
  private messages: any[] = [];
  private cwd: string = '';
  private isProcessing: boolean = false;
  private modelName: string;

  constructor() {
    super();
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || ''
    });
    this.modelName = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  }

  public async start(cwd: string) {
    this.cwd = cwd;
    this.messages = [];
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
      const system = `You are an expert coding assistant running within the NexusFlow IDE.
You have read-only access to the user's workspace at ${this.cwd} through your tools: you can read files and list directories, but you cannot edit files or run commands.
When suggesting code changes, include the proposed diff directly in your text response so the user can apply it themselves.`;

      const tools: Anthropic.Tool[] = [
        {
          name: 'read_file',
          description: 'Read the contents of a file',
          input_schema: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'Path to file relative to workspace' }
            },
            required: ['filePath']
          }
        },
        {
          name: 'list_directory',
          description: 'List the contents of a directory',
          input_schema: {
            type: 'object',
            properties: {
              dirPath: { type: 'string', description: 'Path to directory relative to workspace' }
            },
            required: ['dirPath']
          }
        }
      ];

      let completed = false;

      for (let step = 0; step < 5; step++) {
        if (this.abortController.signal.aborted) break;

        const stream = await this.anthropic.messages.create({
          model: this.modelName,
          max_tokens: 8192,
          system,
          messages: this.messages,
          tools,
          stream: true
        }, { signal: this.abortController.signal });

        let content = '';
        let toolCalls: any[] = [];
        let currentToolCall: any = null;

        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            content += chunk.delta.text;
            self.emit('data', chunk.delta.text);
          } else if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
            currentToolCall = {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              input: ''
            };
            self.emit('data', `\n\n*Running tool: ${currentToolCall.name}*\n`);
          } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta' && currentToolCall) {
            currentToolCall.input += chunk.delta.partial_json;
          } else if (chunk.type === 'content_block_stop') {
            if (currentToolCall) {
              toolCalls.push(currentToolCall);
              currentToolCall = null;
            }
          }
        }

        const assistantContent: any[] = [];
        if (content) assistantContent.push({ type: 'text', text: content });
        for (const tc of toolCalls) {
          try {
            assistantContent.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: JSON.parse(tc.input || '{}')
            });
          } catch (e) {}
        }
        
        this.messages.push({ role: 'assistant', content: assistantContent });

        if (toolCalls.length === 0) {
          completed = true;
          break; // Done with loop
        }

        const toolResultContent: any[] = [];

        for (const tc of toolCalls) {
          try {
            const args = JSON.parse(tc.input || '{}');
            let result = '';
            
            if (tc.name === 'read_file') {
              const absolutePath = path.join(this.cwd, args.filePath);
              result = await fs.readFile(absolutePath, 'utf8');
            } else if (tc.name === 'list_directory') {
              const absolutePath = path.join(this.cwd, args.dirPath);
              result = (await fs.readdir(absolutePath)).join('\n');
            }

            toolResultContent.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: result
            });
          } catch (err: any) {
             toolResultContent.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: `Error: ${err.message}`,
              is_error: true
            });
          }
        }
        
        this.messages.push({
          role: 'user',
          content: toolResultContent
        });
      }

      if (!completed && !this.abortController.signal.aborted) {
        self.emit('data', '\n\n*Stopped after reaching the tool-step limit without a final answer. Send a follow-up message to continue.*\n');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('NativeClaudeAgent error:', err);
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
