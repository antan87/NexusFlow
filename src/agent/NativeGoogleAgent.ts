import { EventEmitter } from 'node:events';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs-extra';
import path from 'node:path';

export class NativeGoogleAgent extends EventEmitter {
  private ai: GoogleGenAI;
  private history: any[] = [];
  private cwd: string = '';
  private isProcessing: boolean = false;
  private abortController: AbortController | null = null;
  private modelName: string;

  constructor() {
    super();
    this.ai = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY || '' 
    });
    // Allow users to override the model via env var, fallback to gemini-2.0-flash
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  }

  public async start(cwd: string) {
    this.cwd = cwd;
    this.history = [];
  }

  public async send(data: string) {
    if (this.isProcessing) return;
    await this.runLoop(data);
  }

  private async runLoop(userInput: string) {
    this.isProcessing = true;
    this.abortController = new AbortController();

    this.history.push({ role: 'user', parts: [{ text: userInput }] });

    try {
      const config: any = {
        systemInstruction: `You are an expert coding assistant running within the NexusFlow IDE. 
You have access to the user's workspace at ${this.cwd}.
Use your tools to read files, run tests, and propose code changes.
When proposing changes, output the diff directly in your text response.`,
        tools: [{
          functionDeclarations: [
            {
              name: 'read_file',
              description: 'Read the contents of a file',
              parameters: {
                type: 'OBJECT',
                properties: { filePath: { type: 'STRING' } },
                required: ['filePath']
              }
            },
            {
              name: 'list_directory',
              description: 'List the contents of a directory',
              parameters: {
                type: 'OBJECT',
                properties: { dirPath: { type: 'STRING' } },
                required: ['dirPath']
              }
            }
          ]
        }]
      };

      for (let step = 0; step < 5; step++) {
        if (this.abortController.signal.aborted) break;

        const responseStream = await this.ai.models.generateContentStream({
          model: this.modelName,
          contents: this.history,
          config
        });

        let fullText = '';
        let functionCalls: any[] = [];

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
        if (functionCalls.length > 0) modelParts.push(...functionCalls.map(fc => ({ functionCall: fc })));
        
        this.history.push({ role: 'model', parts: modelParts });

        if (functionCalls.length === 0) {
          break; // Done
        }

        const functionResponses: any[] = [];
        for (const call of functionCalls) {
          this.emit('data', `\n\n*Running tool: ${call.name}*\n`);
          
          let result = '';
          try {
            const args = call.args || {};
            if (call.name === 'read_file') {
              const absolutePath = path.join(this.cwd, args.filePath as string);
              result = await fs.readFile(absolutePath, 'utf8');
            } else if (call.name === 'list_directory') {
              const absolutePath = path.join(this.cwd, args.dirPath as string);
              result = (await fs.readdir(absolutePath)).join('\n');
            }
          } catch (e: any) {
            result = `Error: ${e.message}`;
          }

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: { result }
            }
          });
        }
        
        this.history.push({ role: 'user', parts: functionResponses });
      }

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.emit('error', err);
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
