import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { getAdapter } from '../harness/index.js';
import type { HarnessAdapter, SessionHandle } from '../harness/interface.js';
import type { PermissionMode } from '../harness/types.js';
import type { AgentExecutionProfile, AgentHarness } from './ProviderRegistry.js';
import { isValidSessionUuid, type AgentSession } from './session.js';

export class ClaudeSdkAdapter extends EventEmitter implements AgentHarness {
  private readonly adapter: HarnessAdapter;
  private handle: SessionHandle | null = null;
  private cwd = '';
  private session: AgentSession | undefined;
  private active = false;

  private currentExecutionProfile: AgentExecutionProfile = 'review';

  constructor(sessionStore?: unknown, adapterOverride?: HarnessAdapter) {
    super();
    this.adapter = adapterOverride ?? getAdapter('claude-code', { sessionStore });
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

    this.currentExecutionProfile = executionProfile;
    const permissionMode: PermissionMode =
      executionProfile === 'workspace-write' ? 'acceptEdits' : 'default';
    // Interim: folder name as workspace ID; key by NexusFlow workspace ID in multi-host production
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
          env: {
            CLAUDE_CODE_PROJECT_DIR_NAME: workspaceId,
            CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.claude'),
          },
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
    let sawDeltaThisTurn = false;
    let lastEmittedSessionId: string | null = null;

    const emitSessionOnce = (id: string) => {
      if (isValidSessionUuid(id) && id !== lastEmittedSessionId) {
        lastEmittedSessionId = id;
        this.emit('session', id);
      }
    };

    void (async () => {
      try {
        // Resolve lazy session ID
        void handle.sessionId().then(emitSessionOnce).catch(() => {});

        for await (const event of handle.events) {
          switch (event.type) {
            case 'session_started':
              emitSessionOnce(event.sessionId);
              break;

            case 'text_delta':
              sawDeltaThisTurn = true;
              this.emit('data', event.text);
              break;

            case 'assistant_message':
              if (!sawDeltaThisTurn && event.text) {
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

            case 'approval_required': {
              if (this.currentExecutionProfile === 'workspace-write') {
                // Issue #173: Tool-class gating — auto-accept in-workspace file edits and common filesystem actions;
                // deny arbitrary shell/command execution with actionable guidance.
                const allowedTools = new Set([
                  'Edit', 'Write', 'MultiEdit', 'NotebookEdit',
                  'Read', 'Glob', 'Grep', 'LS', 'View',
                  'FileEdit', 'FileWrite',
                ]);
                if (allowedTools.has(event.tool)) {
                  handle.respondToApproval(event.requestId, { behavior: 'allow' });
                } else {
                  handle.respondToApproval(event.requestId, {
                    behavior: 'deny',
                    message: `Tool '${event.tool}' requires approval and is unavailable in embedded chat. Run in CLI or full terminal.`,
                  });
                  this.emit('system', `Denied '${event.tool}' execution: unavailable in embedded chat.`);
                }
              } else {
                handle.respondToApproval(event.requestId, {
                  behavior: 'deny',
                  message: 'Action denied: active execution profile is review-only.',
                });
                this.emit('system', `Denied '${event.tool}' execution: active execution profile is review-only.`);
              }
              break;
            }

            case 'turn_completed':
              sawDeltaThisTurn = false;
              this.emit('usage', event.usage);
              this.emit('idle');
              break;

            case 'turn_failed':
              sawDeltaThisTurn = false;
              this.emit('error', new Error(event.error.message));
              this.emit('idle');
              break;
          }
        }
      } catch (err: any) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (this.active) {
          this.emit('idle');
        }
      }
    })();
  }
}
