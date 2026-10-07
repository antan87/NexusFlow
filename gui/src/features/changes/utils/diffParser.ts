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

  let runningSnippetLine = 1;
  for (const hunk of hunks) {
    runningSnippetLine = finalizeHunk(hunk, runningSnippetLine);
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
 * Calculates first actual changed line positions for both modified and original streams,
 * as well as the 1-based snippet line index. Returns next hunk's snippet line start.
 */
function finalizeHunk(hunk: DiffHunkAction, startSnippetLine: number): number {
  let curOrig = hunk.startLineOriginal;
  let curMod = hunk.startLineModified;
  let curSnippet = startSnippetLine;

  let firstChangedMod: number | undefined;
  let firstChangedOrig: number | undefined;
  let firstChangedSnippet: number | undefined;

  for (const line of hunk.lines || []) {
    if (line.startsWith('\\')) {
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (firstChangedMod === undefined) {
        firstChangedMod = curMod;
      }
      if (firstChangedOrig === undefined) {
        firstChangedOrig = curOrig;
      }
      if (firstChangedSnippet === undefined) {
        firstChangedSnippet = curSnippet;
      }
      curMod++;
      curSnippet++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      if (firstChangedMod === undefined) {
        firstChangedMod = Math.max(1, curMod);
      }
      if (firstChangedOrig === undefined) {
        firstChangedOrig = curOrig;
      }
      if (firstChangedSnippet === undefined) {
        firstChangedSnippet = Math.max(1, curSnippet);
      }
      curOrig++;
    } else if (line.startsWith(' ')) {
      curOrig++;
      curMod++;
      curSnippet++;
    }
  }

  hunk.firstChangedLineModified = firstChangedMod ?? hunk.startLineModified;
  hunk.firstChangedLineOriginal = firstChangedOrig ?? hunk.startLineOriginal;
  hunk.firstChangedSnippetLine = firstChangedSnippet ?? startSnippetLine;

  return curSnippet;
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

/**
 * Computes the 1-based snippet line where hunk at index `hunkIndex` starts in modified snippet buffer.
 */
export function getHunkSnippetLine(hunkIndex: number, hunks: DiffHunkAction[]): number {
  let snippetPos = 1;
  for (let i = 0; i < hunkIndex && i < hunks.length; i++) {
    for (const l of hunks[i]?.lines || []) {
      if (!l.startsWith('-') && !l.startsWith('\\')) {
        snippetPos++;
      }
    }
  }
  return snippetPos;
}

/**
 * Computes the 1-based snippet line of the first changed (added/deleted) line
 * for the hunk at index `hunkIndex`. Falls back to the hunk start snippet line.
 */
export function getHunkFirstChangedSnippetLine(hunkIndex: number, hunks: DiffHunkAction[]): number {
  const hunk = hunks[hunkIndex];
  if (!hunk) return 1;
  if (hunk.firstChangedSnippetLine !== undefined) {
    return hunk.firstChangedSnippetLine;
  }
  const snippetPos = getHunkSnippetLine(hunkIndex, hunks);
  let currentSnippet = snippetPos;
  for (const line of hunk.lines || []) {
    if (line.startsWith('\\')) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return currentSnippet;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return currentSnippet;
    }
    if (line.startsWith(' ')) {
      currentSnippet++;
    }
  }
  return snippetPos;
}

export const getFirstChangedSnippetLine = getHunkFirstChangedSnippetLine;

/**
 * Returns the first changed modified line number for a hunk.
 * Falls back to startLineModified if no changes are detected.
 */
export function getHunkFirstChangedLineModified(hunk: DiffHunkAction): number {
  if (hunk.firstChangedLineModified !== undefined) {
    return hunk.firstChangedLineModified;
  }
  let curMod = hunk.startLineModified;
  for (const line of hunk.lines || []) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return curMod;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return Math.max(1, curMod);
    }
    if (line.startsWith(' ')) {
      curMod++;
    }
  }
  return hunk.startLineModified;
}

export const getFirstChangedLineModified = getHunkFirstChangedLineModified;

/**
 * Returns the first changed original line number for a hunk.
 * Falls back to startLineOriginal if no changes are detected.
 */
export function getHunkFirstChangedLineOriginal(hunk: DiffHunkAction): number {
  if (hunk.firstChangedLineOriginal !== undefined) {
    return hunk.firstChangedLineOriginal;
  }
  let curOrig = hunk.startLineOriginal;
  for (const line of hunk.lines || []) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return curOrig;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return curOrig;
    }
    if (line.startsWith(' ')) {
      curOrig++;
    }
  }
  return hunk.startLineOriginal;
}

export const getFirstChangedLineOriginal = getHunkFirstChangedLineOriginal;


