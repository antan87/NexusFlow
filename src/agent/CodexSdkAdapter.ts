import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { getAdapter } from '../harness/index.js';
import type { HarnessAdapter, SessionHandle } from '../harness/interface.js';
import type { AgentExecutionProfile, AgentHarness } from './ProviderRegistry.js';
import { isValidSessionUuid, type AgentSession } from './session.js';

export class CodexSdkAdapter extends EventEmitter implements AgentHarness {
  private readonly adapter: HarnessAdapter;
  private handle: SessionHandle | null = null;
  private cwd = '';
  private session: AgentSession | undefined;
  private active = false;

  constructor() {
    super();
    this.adapter = getAdapter('codex');
  }

  async start(cwd: string, session?: AgentSession): Promise<void> {
    this.cwd = cwd;
    this.session = session;
    this.active = true;
  }

  async send(data: string, executionProfile: AgentExecutionProfile = 'review'): Promise<void> {
    if (!this.active) {
      this.emit('error', new Error('Agent is not started or has been stopped.'));
      return;
    }

    const permissionMode = executionProfile === 'workspace-write' ? 'acceptEdits' : 'default';
    const workspaceId = path.basename(this.cwd);

    if (!this.handle) {
      try {
        const spec = {
          prompt: data,
          workspace: {
            workspaceId,
            rootPath: this.cwd,
          },
          permissionMode,
        };

        if (this.session && this.session.resume) {
          this.handle = await this.adapter.resume({
            ...spec,
            sessionId: this.session.id,
            mode: 'resume',
          });
        } else {
          this.handle = await this.adapter.start(spec);
        }

        this.bindEvents(this.handle);
      } catch (err: any) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        this.emit('idle');
      }
    } else {
      this.handle.send(data);
    }
  }

  stop(): void {
    this.active = false;
    if (this.handle) {
      void this.handle.dispose();
      this.handle = null;
    }
    this.emit('close', 0);
  }

  private bindEvents(handle: SessionHandle): void {
    void (async () => {
      try {
        // Resolve lazy session ID
        void handle.sessionId().then((id) => {
          if (isValidSessionUuid(id)) {
            this.emit('session', id);
          }
        }).catch(() => {});

        for await (const event of handle.events) {
          switch (event.type) {
            case 'session_started':
              if (isValidSessionUuid(event.sessionId)) {
                this.emit('session', event.sessionId);
              }
              break;

            case 'text_delta':
            case 'assistant_message':
              if (event.text) {
                this.emit('data', event.text);
              }
              break;

            case 'tool_requested':
              this.emit('system', `Tool requested: ${event.tool}`);
              break;

            case 'tool_completed':
              this.emit('system', event.ok ? `Tool completed: ${event.callId ?? ''}` : `Tool failed: ${event.callId ?? ''}`);
              break;

            case 'file_changed':
              this.emit('system', `File ${event.kind}: ${event.paths.join(', ')}`);
              break;

            case 'turn_completed':
              this.emit('idle');
              break;

            case 'turn_failed':
              this.emit('error', new Error(event.error.message));
              this.emit('idle');
              break;
          }
        }
      } catch (err: any) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        this.emit('idle');
      }
    })();
  }
}
