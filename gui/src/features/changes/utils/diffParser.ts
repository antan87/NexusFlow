/**
 * Unified diff parsing utility: reconstructs original and modified text streams
 * and extracts structured DiffHunkAction objects for hunk-level triage.
 * File: gui/src/features/changes/utils/diffParser.ts
 */
import type { DiffHunkAction } from '../types.js';

export interface ParsedDiffResult {
  originalContent: string;
  modifiedContent: string;
  hunks: DiffHunkAction[];
  isNewFile: boolean;
  isDeletedFile: boolean;
}

export function parseUnifiedDiff(patchText: string): ParsedDiffResult {
  if (!patchText || !patchText.trim()) {
    return {
      originalContent: '',
      modifiedContent: '',
      hunks: [],
      isNewFile: false,
      isDeletedFile: false,
    };
  }

  const lines = patchText.split(/\r?\n/);
  const hunks: DiffHunkAction[] = [];
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];

  let isNewFile = false;
  let isDeletedFile = false;
  let currentHunk: DiffHunkAction | null = null;
  let hunkCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith('--- /dev/null')) {
      isNewFile = true;
      continue;
    }
    if (line.startsWith('+++ /dev/null')) {
      isDeletedFile = true;
      continue;
    }

    // Match hunk header: @@ -1,7 +1,9 @@ optional code preview
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      hunkCounter++;
      const origStart = parseInt(hunkMatch[1]!, 10);
      const origCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2]!, 10) : 1;
      const modStart = parseInt(hunkMatch[3]!, 10);
      const modCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4]!, 10) : 1;

      currentHunk = {
        id: `hunk-${hunkCounter}`,
        hunkIndex: hunkCounter - 1,
        type: 'accept',
        startLineOriginal: origStart,
        lineCountOriginal: origCount,
        startLineModified: modStart,
        lineCountModified: modCount,
        patchHeader: line,
        enclosingDeclaration: hunkMatch[5]?.trim() || undefined,
        lines: [],
      };
      continue;
    }

    // Skip git metadata headers prior to the first hunk header
    if (!currentHunk) {
      continue;
    }

    currentHunk.lines.push(line);

    if (line.startsWith(' ')) {
      // Context line present in both original and modified
      const content = line.slice(1);
      originalLines.push(content);
      modifiedLines.push(content);
    } else if (line.startsWith('-')) {
      // Line removed from original
      originalLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      // Line added to modified
      modifiedLines.push(line.slice(1));
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      continue;
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return {
    originalContent: originalLines.join('\n'),
    modifiedContent: modifiedLines.join('\n'),
    hunks,
    isNewFile,
    isDeletedFile,
  };
}

/**
 * Maps a 1-based source file line number to the 1-based line number inside a hunk-only snippet buffer.
 * Returns null if the real line falls outside all diff hunks.
 */
export function mapRealLineToSnippetLine(realLine: number, hunks: DiffHunkAction[]): number | null {
  let snippetLine = 1;
  for (const hunk of hunks) {
    let currentRealLine = hunk.startLineModified;
    for (const rawLine of hunk.lines || []) {
      if (rawLine.startsWith('-') || rawLine.startsWith('\\')) {
        continue;
      }
      if (currentRealLine === realLine) {
        return snippetLine;
      }
      snippetLine++;
      currentRealLine++;
    }
  }
  return null;
}

