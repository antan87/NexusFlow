import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface ProviderSession {
  id: string;
  provider: string; // 'claude', 'codex', etc.
  status: 'active' | 'paused' | 'completed' | 'error';
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export class SessionPersistence {
  private db: Database.Database;

  constructor(workspacePath: string) {
    const dbDir = path.join(workspacePath, '.nexusflow');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'sessions.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        workspacePath TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  public createSession(id: string, provider: string, workspacePath: string): ProviderSession {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, provider, status, workspacePath)
      VALUES (?, ?, 'active', ?)
    `);
    stmt.run(id, provider, workspacePath);
    return this.getSession(id)!;
  }

  public getSession(id: string): ProviderSession | undefined {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as ProviderSession | undefined;
    return row;
  }

  public listSessions(workspacePath: string): ProviderSession[] {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE workspacePath = ? ORDER BY updatedAt DESC');
    return stmt.all(workspacePath) as ProviderSession[];
  }

  public updateSessionStatus(id: string, status: ProviderSession['status']): void {
    const stmt = this.db.prepare('UPDATE sessions SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(status, id);
  }

  public close() {
    this.db.close();
  }
}
