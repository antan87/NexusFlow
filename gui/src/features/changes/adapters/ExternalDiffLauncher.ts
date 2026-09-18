/**
 * External Diff Tool Launcher: Invokes local desktop editors (e.g. VS Code Diff)
 * File: gui/src/features/changes/adapters/ExternalDiffLauncher.ts
 */
import { API_BASE } from '../../../lib/apiBase.js';

export function getEditorLabel(defaultEditor?: string | null): string {
  switch (defaultEditor) {
    case 'code-insiders':
    case 'vscode-insiders':
      return 'VS Code Insiders';
    case 'cursor':
      return 'Cursor';
    case 'windsurf':
      return 'Windsurf';
    case 'antigravity':
      return 'Antigravity';
    case 'code':
    case 'vscode':
    default:
      return 'VS Code';
  }
}

export function getEditorCommand(defaultEditor?: string | null): string {
  switch (defaultEditor) {
    case 'code-insiders':
    case 'vscode-insiders':
      return 'code-insiders';
    case 'cursor':
      return 'cursor';
    case 'windsurf':
      return 'windsurf';
    case 'antigravity':
      return 'antigravity';
    case 'code':
    case 'vscode':
    default:
      return 'code';
  }
}

export function getEditorUriScheme(defaultEditor?: string | null): string {
  switch (defaultEditor) {
    case 'code-insiders':
    case 'vscode-insiders':
      return 'vscode-insiders';
    case 'cursor':
      return 'cursor';
    case 'windsurf':
      return 'windsurf';
    case 'antigravity':
      return 'antigravity';
    case 'code':
    case 'vscode':
    default:
      return 'vscode';
  }
}

/**
 * Computes the desktop editor URI for opening a file at a specific line and column.
 */
export function computeEditorUri(
  repoPath: string,
  filePath: string,
  line: number = 1,
  col: number = 1,
  defaultEditor?: string | null,
): string {
  const normalizedRepo = repoPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFile = filePath.replace(/\\/g, '/');

  let fullPath: string;
  // If filePath is already absolute (Windows drive letter or leading slash), do not prepend repoPath
  if (/^[a-zA-Z]:\//.test(normalizedFile) || normalizedFile.startsWith('/')) {
    fullPath = normalizedFile;
  } else {
    const cleanRel = normalizedFile.replace(/^\/+/, '');
    fullPath = normalizedRepo ? `${normalizedRepo}/${cleanRel}` : cleanRel;
  }

  // Ensure no leading slashes to prevent `file//path` double-slash issues in URI
  const cleanPath = fullPath.replace(/^\/+/, '');
  const scheme = getEditorUriScheme(defaultEditor);
  return `${scheme}://file/${encodeURI(cleanPath)}:${line}:${col}`;
}

export async function launchVsCodeDiff(
  repoPath: string,
  filePath: string,
  defaultEditor?: string | null,
): Promise<boolean> {
  const command = getEditorCommand(defaultEditor);
  const label = getEditorLabel(defaultEditor);
  try {
    const res = await fetch(`${API_BASE}/api/open-editor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath: repoPath,
        command,
        filePath,
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Failed to launch ${label}`);
    }
    return true;
  } catch (err) {
    console.error('Failed to launch external diff tool:', err);
    return false;
  }
}

/**
 * Launches local desktop editor directly at a specific file, line, and column using the editor URI scheme.
 */
export function openInVsCodeAtLine(
  repoPath: string,
  filePath: string,
  line: number = 1,
  col: number = 1,
  defaultEditor?: string | null,
): void {
  const uri = computeEditorUri(repoPath, filePath, line, col, defaultEditor);
  if (typeof window !== 'undefined' && window.open) {
    window.open(uri, '_blank');
  }
}

