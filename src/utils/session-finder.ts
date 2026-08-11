/**
 * @module utils/session-finder
 * Scans local storage directories of various AI coding assistants to find conversation histories.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AISession, ChatMessage } from '../types.js';

/**
 * Derives the directory name that Claude Code uses inside `~/.claude/projects/`
 * for a given absolute project directory path.
 *
 * Claude Code replaces EVERY non-alphanumeric character with a hyphen and does
 * not collapse runs, so a Windows path like `C:\Users\a.b\Git\improve_las`
 * becomes `C--Users-a-b-Git-improve-las` (the drive colon and the `\` each map
 * to their own dash → `C--`, and the `.` in the user name becomes a dash).
 */
export function getClaudeProjectFolderName(absolutePath: string): string {
  return absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Extract plain text from a Claude transcript record's message. */
export function claudeRecordText(record: any): string {
  const raw = record?.message?.text ?? record?.message?.content ?? record?.text ?? '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw.map((b: any) => (typeof b === 'string' ? b : b?.text || b?.content || '')).join(' ');
  }
  return '';
}

/**
 * True for a Claude "user" record that is CLI-injected noise rather than a
 * typed prompt: meta caveats, slash-command wrappers, command stdout, or a
 * tool-result payload. These pollute session titles and loaded transcripts.
 */
export function isNoiseUserRecord(record: any, text: string): boolean {
  if (record?.isMeta) return true;
  // Content that is only tool_result / non-text blocks isn't a real prompt.
  const raw = record?.message?.content;
  if (Array.isArray(raw) && !raw.some((b: any) => typeof b === 'string' || b?.type === 'text')) {
    return true;
  }
  const t = text.trimStart();
  if (t === '') return true;
  return /^<(command-name|command-message|command-args|local-command-stdout|local-command-caveat|bash-input|bash-stdout|bash-stderr)>/.test(t);
}

/** Extract plain text from a Codex `response_item` message payload. */
export function codexMessageText(payload: any): string {
  const content = payload?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('');
  }
  return '';
}

/** Extract the resumable thread UUID from a Codex `session_meta` record. */
export function codexSessionId(record: any): string | null {
  const id = record?.type === 'session_meta' ? record?.payload?.id : null;
  return isCodexSessionId(id) ? id : null;
}

export function isCodexSessionId(id: unknown): id is string {
  return typeof id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * True for a user message that is CLI-injected context (Codex
 * <environment_context>/<user_instructions>, Copilot <system_reminder>) rather
 * than something the user typed.
 */
export function isInjectedContextText(text: string): boolean {
  const t = text.trimStart();
  return /^<(system_reminder|system-reminder|environment_context|user_instructions)>/.test(t);
}

/**
 * Opens GitHub Copilot's SQLite session store (`~/.copilot/session-store.db`)
 * read-only via Node's built-in `node:sqlite`. Returns null when the store is
 * absent or the runtime lacks node:sqlite (e.g. an older bundled Node in a
 * packaged Electron build) so Copilot support degrades gracefully instead of
 * throwing. Caller must close the returned handle.
 */
async function openCopilotDb(): Promise<any | null> {
  try {
    const dbPath = path.join(os.homedir(), '.copilot', 'session-store.db');
    await fs.access(dbPath);
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

/**
 * Recursively retrieves all files in a directory that match a specific extension.
 */
async function getFilesRecursively(dir: string, extension: string): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await getFilesRecursively(fullPath, extension);
        result.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        result.push(fullPath);
      }
    }
  } catch {}
  return result;
}

/**
 * Compare already-canonical paths without weakening case rules on POSIX.
 * Windows drive paths are case-insensitive; POSIX paths remain case-sensitive.
 */
export function isCanonicalPathWithin(
  rootPath: string,
  candidatePath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const normalize = (value: string) => {
    const resolved = pathApi.resolve(value);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const root = normalize(rootPath);
  const candidate = normalize(candidatePath);
  const relative = pathApi.relative(root, candidate);
  return relative === ''
    || (relative !== '..'
      && !relative.startsWith(`..${pathApi.sep}`)
      && !pathApi.isAbsolute(relative));
}

/**
 * Authorize a Codex Desktop handoff using only the rollout's recorded cwd.
 * Discovery may use fuzzy matching for old files, but process-launch boundaries
 * must never treat transcript text or a workspace basename as ownership proof.
 */
export async function canOpenCodexSessionInWorkspace(
  workspacePath: string,
  repoPaths: string[],
  sessionId: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (!isCodexSessionId(sessionId)) return false;

  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const roots = (await Promise.all(
    [workspacePath, ...repoPaths].map(async (candidate) => {
      try {
        return await fs.realpath(candidate);
      } catch {
        return null;
      }
    }),
  )).filter((candidate): candidate is string => candidate !== null);
  if (roots.length === 0) return false;

  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const codexFiles = await getFilesRecursively(path.join(codexHome, 'sessions'), '.jsonl');
  for (const file of codexFiles) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      for (const line of content.split('\n').filter(Boolean)) {
        let record: any;
        try { record = JSON.parse(line); } catch { continue; }
        if (codexSessionId(record) !== sessionId) continue;
        const recordedCwd = record?.payload?.cwd;
        if (typeof recordedCwd !== 'string' || !pathApi.isAbsolute(recordedCwd)) continue;

        let canonicalCwd: string;
        try {
          canonicalCwd = await fs.realpath(recordedCwd);
        } catch {
          continue;
        }
        if (roots.some((root) => isCanonicalPathWithin(root, canonicalCwd, platform))) {
          return true;
        }
      }
    } catch {
      // Ignore unreadable or concurrently-rotated rollout files.
    }
  }
  return false;
}

/**
 * Scans the local filesystem for conversation histories belonging to Claude, Antigravity,
 * Codex, and Copilot that relate to the specified workspace.
 *
 * @param workspacePath - Root directory of the active workspace.
 * @param repoPaths - Directories of sub-repositories included in the workspace.
 * @returns A promise that resolves to an array of {@link AISession} objects sorted by update time descending.
 */
export async function findSessions(workspacePath: string, repoPaths: string[] = []): Promise<AISession[]> {
  const sessions: AISession[] = [];
  const wsFolderName = path.basename(workspacePath);

  // Normalization helper for accurate path comparison
  const normalizePath = (p: string) => path.normalize(p).toLowerCase();
  const normWorkspace = normalizePath(workspacePath);
  const normRepos = repoPaths.map(r => normalizePath(r));

  const isPathMatch = (sessPath?: string) => {
    if (!sessPath) return false;
    const normSess = normalizePath(sessPath);
    if (normSess === normWorkspace || normSess.startsWith(normWorkspace + path.sep)) return true;
    for (const r of normRepos) {
      if (normSess === r || normSess.startsWith(r + path.sep)) return true;
    }
    return false;
  };

  // ─── 1. Scan Antigravity Sessions ──────────────────────────────────────
  const agDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  const agHistoryPath = path.join(agDir, 'history.jsonl');
  
  try {
    const historyContent = await fs.readFile(agHistoryPath, 'utf-8');
    const lines = historyContent.split('\n').filter(Boolean);
    const conversationsMap = new Map<string, { id: string; title: string; entries: any[] }>();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.conversationId && isPathMatch(entry.workspace)) {
          if (!conversationsMap.has(entry.conversationId)) {
            conversationsMap.set(entry.conversationId, {
              id: entry.conversationId,
              title: entry.display || 'Untitled Conversation',
              entries: [],
            });
          }
          conversationsMap.get(entry.conversationId)!.entries.push(entry);
        }
      } catch {}
    }

    for (const [convId, convData] of conversationsMap.entries()) {
      const transcriptPath = path.join(agDir, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');
      let messageCount = 0;
      let createdAt = new Date(convData.entries[0]?.timestamp || Date.now()).toISOString();
      let updatedAt = new Date(convData.entries[convData.entries.length - 1]?.timestamp || Date.now()).toISOString();
      let title = convData.title;

      try {
        const transcriptContent = await fs.readFile(transcriptPath, 'utf-8');
        const transcriptLines = transcriptContent.split('\n').filter(Boolean);
        let firstUserMessage = null;

        for (const line of transcriptLines) {
          const tObj = JSON.parse(line);
          if (tObj.type === 'USER_INPUT' || tObj.type === 'PLANNER_RESPONSE') {
            messageCount++;
            if (tObj.type === 'USER_INPUT' && !firstUserMessage) {
              firstUserMessage = tObj.content;
            }
          }
        }

        if (firstUserMessage) {
          const cleanMatch = firstUserMessage.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
          title = cleanMatch ? cleanMatch[1].trim() : firstUserMessage.trim();
        }
      } catch {
        messageCount = convData.entries.length * 2;
      }

      if (title.length > 80) {
        title = title.substring(0, 80) + '...';
      }

      sessions.push({
        id: convId,
        assistant: 'antigravity',
        title,
        createdAt,
        updatedAt,
        messageCount,
        workspacePath,
      });
    }
  } catch {}

  // ─── 2. Scan Claude Code Sessions ──────────────────────────────────────
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const claudeProjectsDir = path.join(claudeConfigDir, 'projects');
  
  try {
    const candidateFolders = [
      getClaudeProjectFolderName(workspacePath),
      ...repoPaths.map(r => getClaudeProjectFolderName(r))
    ];

    for (const folder of candidateFolders) {
      const projectPath = path.join(claudeProjectsDir, folder);
      try {
        const files = await fs.readdir(projectPath);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

        for (const file of jsonlFiles) {
          const filePath = path.join(projectPath, file);
          const sessionId = path.basename(file, '.jsonl');

          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(Boolean);
            
            let messageCount = 0;
            let createdAt = null;
            let updatedAt = null;
            let title = 'Claude Session';

            for (const line of lines) {
              const record = JSON.parse(line);
              if (record.timestamp) {
                if (!createdAt) createdAt = record.timestamp;
                updatedAt = record.timestamp;
              }

              if (record.type === 'user' || record.type === 'assistant') {
                const text = claudeRecordText(record);
                // CLI-injected caveats, slash commands and tool results aren't
                // real turns — exclude them from the count and the title.
                const isNoise = record.type === 'user' && isNoiseUserRecord(record, text);
                if (isNoise) continue;
                messageCount++;
                if (record.type === 'user' && title === 'Claude Session' && text.trim()) {
                  title = text.trim();
                }
              }
            }

            if (title.length > 80) {
              title = title.substring(0, 80) + '...';
            }

            sessions.push({
              id: sessionId,
              assistant: 'claude',
              title,
              createdAt: createdAt || new Date().toISOString(),
              updatedAt: updatedAt || new Date().toISOString(),
              messageCount,
              workspacePath,
            });
          } catch {}
        }
      } catch {}
    }
  } catch {}

  // ─── 3. OpenAI Codex Sessions (rollout-*.jsonl) ──────────────────────────
  // Codex writes a `session_meta` record (payload.cwd) followed by
  // `response_item` records (payload.type==='message', role, content[].text).
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const codexSessionsDir = path.join(codexHome, 'sessions');
  try {
    const codexFiles = await getFilesRecursively(codexSessionsDir, '.jsonl');
    for (const file of codexFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n').filter(Boolean);

        let sessionCwd: string | null = null;
        let sessionId: string | null = null;
        let messageCount = 0;
        let createdAt: string | null = null;
        let updatedAt: string | null = null;
        let title = 'Codex Session';

        for (const line of lines) {
          let record: any;
          try { record = JSON.parse(line); } catch { continue; }

          const ts = record.timestamp || record.payload?.timestamp;
          if (ts) {
            const iso = new Date(ts).toISOString();
            if (!createdAt) createdAt = iso;
            updatedAt = iso;
          }

          if (record.type === 'session_meta') {
            if (record.payload?.cwd) sessionCwd = record.payload.cwd;
            sessionId = codexSessionId(record) ?? sessionId;
          } else if (record.type === 'response_item' && record.payload?.type === 'message') {
            const role = record.payload.role;
            if (role !== 'user' && role !== 'assistant') continue;
            const text = codexMessageText(record.payload).trim();
            if (role === 'user' && (!text || isInjectedContextText(text))) continue;
            messageCount++;
            if (role === 'user' && title === 'Codex Session' && text) {
              title = text;
            }
          }
        }

        // Match on the recorded cwd; fall back to a content scan for older files.
        const matched = sessionCwd
          ? isPathMatch(sessionCwd)
          : (content.toLowerCase().includes(normWorkspace) || content.includes(wsFolderName));
        if (!matched) continue;
        // Skip contentless sessions (only injected context, no real turns).
        if (messageCount === 0) continue;

        // Current rollout filenames include timestamps. The stable resume id is
        // session_meta.payload.id, not the filename.
        if (!sessionId) continue;
        sessions.push({
          id: sessionId,
          assistant: 'codex',
          title: title.length > 80 ? title.substring(0, 80) + '...' : title,
          createdAt: createdAt || new Date().toISOString(),
          updatedAt: updatedAt || new Date().toISOString(),
          messageCount,
          workspacePath,
        });
      } catch {}
    }
  } catch {}

  // ─── 4. GitHub Copilot Sessions (SQLite session store) ───────────────────
  // Copilot keeps sessions in ~/.copilot/session-store.db: a `sessions` table
  // (id, cwd, summary, timestamps) and a `turns` table (user_message /
  // assistant_response per turn). Match on `cwd` like the other harnesses.
  const copilotDb = await openCopilotDb();
  if (copilotDb) {
    try {
      const rows = copilotDb.prepare(
        'SELECT id, cwd, summary, created_at, updated_at FROM sessions'
      ).all() as any[];
      for (const row of rows) {
        if (!isPathMatch(row.cwd)) continue;

        const counted = copilotDb.prepare(
          `SELECT
             SUM(CASE WHEN TRIM(COALESCE(user_message, '')) != '' THEN 1 ELSE 0 END)
             + SUM(CASE WHEN TRIM(COALESCE(assistant_response, '')) != '' THEN 1 ELSE 0 END) AS n
           FROM turns WHERE session_id = ?`
        ).get(row.id) as any;
        const messageCount = Number(counted?.n ?? 0);

        let title = (row.summary || '').trim();
        if (!title) {
          const first = copilotDb.prepare(
            `SELECT user_message FROM turns
             WHERE session_id = ? AND TRIM(COALESCE(user_message, '')) != ''
               AND TRIM(user_message) NOT LIKE '<%'
             ORDER BY turn_index LIMIT 1`
          ).get(row.id) as any;
          title = (first?.user_message || '').trim();
        }
        // Skip contentless sessions (no summary and no turns).
        if (!title && messageCount === 0) continue;
        if (!title) title = 'Copilot Session';

        sessions.push({
          id: row.id,
          assistant: 'copilot',
          title: title.length > 80 ? title.substring(0, 80) + '...' : title,
          createdAt: row.created_at || new Date().toISOString(),
          updatedAt: row.updated_at || new Date().toISOString(),
          messageCount,
          workspacePath,
        });
      }
    } catch {
      // Leave Copilot out rather than fail the whole listing.
    } finally {
      try { copilotDb.close(); } catch {}
    }
  }

  // Sort by updatedAt descending
  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return sessions;
}

/**
 * Reads and parses the full transcript for a specific assistant conversation session.
 *
 * @param assistant - The name of the AI assistant ('antigravity', 'claude', 'codex', 'copilot').
 * @param sessionId - Unique ID of the conversation session.
 * @returns A promise that resolves to an array of {@link ChatMessage} objects.
 */
export async function getSessionTranscript(assistant: string, sessionId: string): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];

  if (assistant === 'antigravity') {
    const agDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
    const transcriptPath = path.join(agDir, 'brain', sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    const content = await fs.readFile(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      const obj = JSON.parse(line);
      if (obj.type === 'USER_INPUT') {
        const rawContent = obj.content || '';
        const cleanMatch = rawContent.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        const cleanContent = cleanMatch ? cleanMatch[1].trim() : rawContent.trim();
        messages.push({
          role: 'user',
          content: cleanContent,
          timestamp: obj.created_at || obj.timestamp,
        });
      } else if (obj.type === 'PLANNER_RESPONSE') {
        const content = (obj.content || '').trim();
        if (content) {
          messages.push({
            role: 'assistant',
            content,
            timestamp: obj.created_at || obj.timestamp,
          });
        }
      }
    }
  } else if (assistant === 'claude') {
    const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const claudeProjectsDir = path.join(claudeConfigDir, 'projects');
    const projectFolders = await fs.readdir(claudeProjectsDir).catch(() => [] as string[]);
    let transcriptPath: string | null = null;

    for (const folder of projectFolders) {
      const p = path.join(claudeProjectsDir, folder, `${sessionId}.jsonl`);
      try {
        await fs.access(p);
        transcriptPath = p;
        break;
      } catch {}
    }

    if (!transcriptPath) {
      throw new Error(`Claude session ${sessionId} not found`);
    }

    const content = await fs.readFile(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      const record = JSON.parse(line);
      const isUser = record.type === 'user' || record.role === 'user';
      const isAssistant = record.type === 'assistant' || record.role === 'assistant';
      if (!isUser && !isAssistant) continue;

      const cleanText = claudeRecordText(record).trim();
      // Drop CLI-injected caveats/slash-commands/tool-results and empty turns.
      if (isUser && isNoiseUserRecord(record, cleanText)) continue;
      if (!cleanText) continue;

      if (isUser) {
        messages.push({
          role: 'user',
          content: cleanText,
          timestamp: record.timestamp || record.created_at,
        });
      } else {
        messages.push({
          role: 'assistant',
          content: cleanText,
          timestamp: record.timestamp || record.created_at,
        });
      }
    }
  } else if (assistant === 'codex') {
    if (!isCodexSessionId(sessionId)) {
      throw new Error('Invalid Codex session id');
    }
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const codexSessionsDir = path.join(codexHome, 'sessions');
    const codexFiles = await getFilesRecursively(codexSessionsDir, '.jsonl');
    let transcriptPath: string | null = null;

    // Filename matches are checked first for speed, but metadata is always the
    // authority; a suffix collision or renamed rollout must never select a
    // different thread.
    const candidates = [...codexFiles].sort((a, b) => {
      const aMatch = path.basename(a, '.jsonl').endsWith(sessionId) ? 0 : 1;
      const bMatch = path.basename(b, '.jsonl').endsWith(sessionId) ? 0 : 1;
      return aMatch - bMatch;
    });
    for (const file of candidates) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const found = content
          .split('\n')
          .filter(Boolean)
          .some((line) => {
            try { return codexSessionId(JSON.parse(line)) === sessionId; } catch { return false; }
          });
        if (found) {
          transcriptPath = file;
          break;
        }
      } catch {
        // Ignore unreadable or concurrently-rotated rollout files.
      }
    }

    if (!transcriptPath) {
      throw new Error(`Codex session ${sessionId} not found`);
    }

    const content = await fs.readFile(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      let record: any;
      try { record = JSON.parse(line); } catch { continue; }
      if (record.type !== 'response_item' || record.payload?.type !== 'message') continue;
      const role = record.payload.role;
      if (role === 'user' || role === 'assistant') {
        const text = codexMessageText(record.payload).trim();
        if (role === 'user' && isInjectedContextText(text)) continue;
        if (!text) continue;
        const ts = record.timestamp || record.payload?.timestamp;
        messages.push({
          role: role as 'user' | 'assistant',
          content: text,
          timestamp: ts ? new Date(ts).toISOString() : undefined,
        });
      }
    }
  } else if (assistant === 'copilot') {
    const copilotDb = await openCopilotDb();
    if (!copilotDb) {
      throw new Error('Copilot session store is unavailable in this runtime.');
    }
    try {
      const turns = copilotDb.prepare(
        'SELECT user_message, assistant_response, timestamp FROM turns WHERE session_id = ? ORDER BY turn_index'
      ).all(sessionId) as any[];
      for (const t of turns) {
        const user = (t.user_message || '').trim();
        const assistantText = (t.assistant_response || '').trim();
        // Skip Copilot's injected <system_reminder> pseudo-turns.
        if (user && !isInjectedContextText(user)) {
          messages.push({ role: 'user', content: user, timestamp: t.timestamp });
        }
        if (assistantText) messages.push({ role: 'assistant', content: assistantText, timestamp: t.timestamp });
      }
    } finally {
      try { copilotDb.close(); } catch {}
    }
  }

  return messages;
}
