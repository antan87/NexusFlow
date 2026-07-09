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
 * It replaces special characters /, \, space, -, and _ with a hyphen.
 */
export function getClaudeProjectFolderName(absolutePath: string): string {
  return absolutePath.replace(/[\\\/ _-]+/g, '-');
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
                messageCount++;
                if (record.type === 'user' && title === 'Claude Session') {
                  const rawText = record.message?.text || record.message?.content || '';
                  if (typeof rawText === 'string') {
                    title = rawText.trim();
                  } else if (Array.isArray(rawText)) {
                    title = rawText.map((b: any) => b.text || b.content || '').join(' ').trim();
                  }
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

  // ─── 3. Scan OpenAI Codex Sessions ──────────────────────────────────────
  const codexDir = path.join(os.homedir(), '.codex');
  const codexSessionsDir = path.join(codexDir, 'sessions');
  try {
    const codexFiles = await getFilesRecursively(codexSessionsDir, '.jsonl');
    for (const file of codexFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        // Heuristic: check if the file references our workspace path or folder name
        if (!content.toLowerCase().includes(normWorkspace) && !content.includes(wsFolderName)) {
          continue;
        }

        const lines = content.split('\n').filter(Boolean);
        let messageCount = 0;
        let createdAt: string | null = null;
        let updatedAt: string | null = null;
        let title = 'Codex Session';

        for (const line of lines) {
          try {
            const record = JSON.parse(line);
            if (record.timestamp) {
              if (!createdAt) createdAt = new Date(record.timestamp).toISOString();
              updatedAt = new Date(record.timestamp).toISOString();
            }
            const role = record.role || record.message?.role || (record.prompt ? 'user' : record.completion ? 'assistant' : null);
            if (role === 'user' || role === 'assistant') {
              messageCount++;
              if (role === 'user' && title === 'Codex Session') {
                const text = record.content || record.prompt || record.message?.content || '';
                if (text) title = text.trim();
              }
            }
          } catch {}
        }

        const sessionId = path.basename(file, '.jsonl');
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

  // ─── 4. Scan GitHub Copilot Sessions ────────────────────────────────────
  const copilotDir = path.join(os.homedir(), '.copilot');
  const copilotSessionsDirs = [
    path.join(copilotDir, 'session-state'),
    path.join(copilotDir, 'history-session-state')
  ];
  for (const dir of copilotSessionsDirs) {
    try {
      const copilotFiles = await getFilesRecursively(dir, '.json');
      for (const file of copilotFiles) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          // Heuristic check
          if (!content.toLowerCase().includes(normWorkspace) && !content.includes(wsFolderName)) {
            continue;
          }

          const record = JSON.parse(content);
          let messageCount = 0;
          let title = 'Copilot Session';
          let messagesList: any[] = [];

          if (Array.isArray(record)) {
            messagesList = record;
          } else if (record && Array.isArray(record.messages)) {
            messagesList = record.messages;
          }

          for (const msg of messagesList) {
            const role = msg.role || (msg.type === 'user' ? 'user' : msg.type === 'assistant' ? 'assistant' : null);
            if (role === 'user' || role === 'assistant') {
              messageCount++;
              if (role === 'user' && title === 'Copilot Session') {
                const text = msg.content || msg.text || '';
                if (text) title = text.trim();
              }
            }
          }

          const stats = await fs.stat(file);
          const sessionId = path.basename(file, '.json');

          sessions.push({
            id: sessionId,
            assistant: 'copilot',
            title: title.length > 80 ? title.substring(0, 80) + '...' : title,
            createdAt: stats.birthtime.toISOString(),
            updatedAt: stats.mtime.toISOString(),
            messageCount,
            workspacePath,
          });
        } catch {}
      }
    } catch {}
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
      if (record.type === 'user' || record.role === 'user') {
        const rawText = record.message?.text || record.message?.content || record.text || '';
        let cleanText = '';
        if (typeof rawText === 'string') {
          cleanText = rawText.trim();
        } else if (Array.isArray(rawText)) {
          cleanText = rawText.map((b: any) => b.text || b.content || '').join(' ').trim();
        }
        messages.push({
          role: 'user',
          content: cleanText,
          timestamp: record.timestamp || record.created_at,
        });
      } else if (record.type === 'assistant' || record.role === 'assistant') {
        const rawText = record.message?.text || record.message?.content || record.text || '';
        let cleanText = '';
        if (typeof rawText === 'string') {
          cleanText = rawText.trim();
        } else if (Array.isArray(rawText)) {
          cleanText = rawText.map((b: any) => b.text || b.content || '').join(' ').trim();
        }
        messages.push({
          role: 'assistant',
          content: cleanText,
          timestamp: record.timestamp || record.created_at,
        });
      }
    }
  } else if (assistant === 'codex') {
    const codexDir = path.join(os.homedir(), '.codex');
    const codexSessionsDir = path.join(codexDir, 'sessions');
    const codexFiles = await getFilesRecursively(codexSessionsDir, '.jsonl');
    let transcriptPath: string | null = null;

    for (const file of codexFiles) {
      if (path.basename(file, '.jsonl') === sessionId) {
        transcriptPath = file;
        break;
      }
    }

    if (!transcriptPath) {
      throw new Error(`Codex session ${sessionId} not found`);
    }

    const content = await fs.readFile(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      const record = JSON.parse(line);
      const role = record.role || record.message?.role || (record.prompt ? 'user' : record.completion ? 'assistant' : null);
      if (role === 'user' || role === 'assistant') {
        const text = record.content || record.prompt || record.completion || record.message?.content || '';
        messages.push({
          role: role as 'user' | 'assistant',
          content: text.trim(),
          timestamp: record.timestamp ? new Date(record.timestamp).toISOString() : undefined,
        });
      }
    }
  } else if (assistant === 'copilot') {
    const copilotDir = path.join(os.homedir(), '.copilot');
    const copilotSessionsDirs = [
      path.join(copilotDir, 'session-state'),
      path.join(copilotDir, 'history-session-state')
    ];
    let transcriptPath: string | null = null;

    for (const dir of copilotSessionsDirs) {
      const files = await getFilesRecursively(dir, '.json');
      for (const file of files) {
        if (path.basename(file, '.json') === sessionId) {
          transcriptPath = file;
          break;
        }
      }
      if (transcriptPath) break;
    }

    if (!transcriptPath) {
      throw new Error(`Copilot session ${sessionId} not found`);
    }

    const content = await fs.readFile(transcriptPath, 'utf-8');
    const record = JSON.parse(content);
    let messagesList: any[] = [];

    if (Array.isArray(record)) {
      messagesList = record;
    } else if (record && Array.isArray(record.messages)) {
      messagesList = record.messages;
    }

    for (const msg of messagesList) {
      const role = msg.role || (msg.type === 'user' ? 'user' : msg.type === 'assistant' ? 'assistant' : null);
      if (role === 'user' || role === 'assistant') {
        messages.push({
          role: role as 'user' | 'assistant',
          content: (msg.content || msg.text || '').trim(),
          timestamp: msg.timestamp || msg.created_at,
        });
      }
    }
  }

  return messages;
}
