import { execa, type ExecaChildProcess } from 'execa';
import { SessionPersistence, type ProviderSession } from './SessionPersistence.js';

export class ProviderRegistry {
  private persistence: SessionPersistence;
  private activeProcesses: Map<string, ExecaChildProcess<string>> = new Map();

  constructor(workspacePath: string) {
    this.persistence = new SessionPersistence(workspacePath);
  }

  /**
   * Spins up a local instance of an agent and stores its state in SQLite.
   */
  public async launchAgent(
    sessionId: string,
    providerName: string,
    workspacePath: string,
    commandArgs: string[]
  ): Promise<ProviderSession> {
    // 1. Create or resume session in SQLite
    let session = this.persistence.getSession(sessionId);
    if (!session) {
      session = this.persistence.createSession(sessionId, providerName, workspacePath);
    } else {
      this.persistence.updateSessionStatus(sessionId, 'active');
    }

    // 2. Launch the agent process (e.g. CLI for Cursor/Codex/Claude)
    const proc = execa(commandArgs[0], commandArgs.slice(1), {
      cwd: workspacePath,
      env: { ...process.env, NEXUSFLOW_SESSION_ID: sessionId },
    });

    this.activeProcesses.set(sessionId, proc);

    // 3. Monitor process to update status when it dies
    proc.catch((err) => {
      console.error(`Agent process ${sessionId} error:`, err);
      this.persistence.updateSessionStatus(sessionId, 'error');
      this.activeProcesses.delete(sessionId);
    }).then(() => {
      if (this.activeProcesses.has(sessionId)) {
        this.persistence.updateSessionStatus(sessionId, 'completed');
        this.activeProcesses.delete(sessionId);
      }
    });

    return session;
  }

  /**
   * Connect to an existing session (e.g. checking its status or logs)
   */
  public getSessionState(sessionId: string): ProviderSession | undefined {
    return this.persistence.getSession(sessionId);
  }

  public listSessions(workspacePath: string): ProviderSession[] {
    return this.persistence.listSessions(workspacePath);
  }

  public async stopAgent(sessionId: string): Promise<void> {
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      proc.kill();
      this.activeProcesses.delete(sessionId);
      this.persistence.updateSessionStatus(sessionId, 'paused');
    }
  }

  public shutdown() {
    for (const [id, proc] of this.activeProcesses.entries()) {
      proc.kill();
      this.persistence.updateSessionStatus(id, 'paused');
    }
    this.persistence.close();
  }
}
