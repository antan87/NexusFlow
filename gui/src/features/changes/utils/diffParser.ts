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

const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;

export type PatchLineKind = 'header' | 'hunk' | 'context' | 'added' | 'removed' | 'meta';

export interface PatchLine {
  text: string;
  kind: PatchLineKind;
  /** The line's number in the original file, for context and removed lines (and the start, for a hunk header). */
  origLine?: number;
  /** The line's number in the modified file, for context and added lines (and the start, for a hunk header). */
  modLine?: number;
}

/**
 * What a line of a hunk's body is. Inside a hunk the first character decides alone: `--- x` is a
 * removed `-- x` (a SQL or Lua comment), `+++ x` an added `++ x`. An empty line is a context line
 * whose leading space a tool trimmed.
 */
export function hunkLineKind(line: string): 'context' | 'added' | 'removed' | 'meta' {
  if (line.startsWith('+')) return 'added';
  if (line.startsWith('-')) return 'removed';
  if (line.startsWith('\\')) return 'meta';
  return 'context';
}

/**
 * Classifies every line of a unified diff the way git means it. A hunk's body is exactly as many
 * lines as its header promises, so `---` and `+++` are file headers only outside a hunk. Every
 * reader of a patch (the parser, the snippet mapping, the plain patch view) goes through this, so
 * they agree on which line is which.
 */
export function classifyPatch(patchText: string): PatchLine[] {
  const result: PatchLine[] = [];
  let origLeft = 0;
  let modLeft = 0;
  let orig = 0;
  let mod = 0;
  for (const text of patchText.split(/\r?\n/)) {
    if (origLeft > 0 || modLeft > 0) {
      const kind = hunkLineKind(text);
      if (kind === 'meta') { result.push({ text, kind }); continue; }
      if (kind === 'added' && modLeft > 0) { mod += 1; modLeft -= 1; result.push({ text, kind, modLine: mod }); continue; }
      if (kind === 'removed' && origLeft > 0) { orig += 1; origLeft -= 1; result.push({ text, kind, origLine: orig }); continue; }
      if (kind === 'context' && (text.startsWith(' ') || text === '') && origLeft > 0 && modLeft > 0) {
        orig += 1; mod += 1; origLeft -= 1; modLeft -= 1;
        result.push({ text, kind, origLine: orig, modLine: mod });
        continue;
      }
      // A line the header did not promise ends the hunk (a header that over-counted).
      origLeft = 0;
      modLeft = 0;
    }
    if (text.startsWith('\\')) { result.push({ text, kind: 'meta' }); continue; }
    const header = HUNK_HEADER.exec(text);
    if (header) {
      orig = Number(header[1]) - 1;
      mod = Number(header[3]) - 1;
      origLeft = header[2] === undefined ? 1 : Number(header[2]);
      modLeft = header[4] === undefined ? 1 : Number(header[4]);
      result.push({ text, kind: 'hunk', origLine: orig + 1, modLine: mod + 1 });
      continue;
    }
    result.push({ text, kind: 'header' });
  }
  return result;
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

  const hunks: DiffHunkAction[] = [];
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];
  let isNewFile = false;
  let isDeletedFile = false;
  let currentHunk: DiffHunkAction | null = null;

  for (const { text, kind } of classifyPatch(patchText)) {
    if (kind === 'header') {
      if (text.startsWith('--- /dev/null')) isNewFile = true;
      else if (text.startsWith('+++ /dev/null')) isDeletedFile = true;
      continue;
    }
    if (kind === 'hunk') {
      if (currentHunk) hunks.push(currentHunk);
      const match = HUNK_HEADER.exec(text)!;
      currentHunk = {
        id: `hunk-${hunks.length + 1}`,
        hunkIndex: hunks.length,
        type: 'accept',
        startLineOriginal: Number(match[1]),
        lineCountOriginal: match[2] !== undefined ? Number(match[2]) : 1,
        startLineModified: Number(match[3]),
        lineCountModified: match[4] !== undefined ? Number(match[4]) : 1,
        patchHeader: text,
        enclosingDeclaration: match[5]?.trim() || undefined,
        lines: [],
      };
      continue;
    }
    if (!currentHunk) continue;
    currentHunk.lines.push(text);
    if (kind === 'context') {
      originalLines.push(text.slice(1));
      modifiedLines.push(text.slice(1));
    } else if (kind === 'removed') {
      originalLines.push(text.slice(1));
    } else if (kind === 'added') {
      modifiedLines.push(text.slice(1));
    }
  }
  if (currentHunk) hunks.push(currentHunk);

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
 * Records where a hunk starts in the snippet buffer (the modified side of every hunk, one after
 * the other) and where its first change is, on both sides and in the snippet. Returns where the
 * next hunk starts in the snippet buffer.
 */
function finalizeHunk(hunk: DiffHunkAction, startSnippetLine: number): number {
  let curOrig = hunk.startLineOriginal;
  let curMod = hunk.startLineModified;
  let curSnippet = startSnippetLine;
  let firstChangedMod: number | undefined;
  let firstChangedOrig: number | undefined;
  let firstChangedSnippet: number | undefined;

  for (const line of hunk.lines) {
    const kind = hunkLineKind(line);
    if (kind === 'meta') continue;
    if (kind !== 'context' && firstChangedMod === undefined) {
      firstChangedMod = Math.max(1, curMod);
      firstChangedOrig = curOrig;
      firstChangedSnippet = Math.max(1, curSnippet);
    }
    if (kind === 'added') {
      curMod += 1;
      curSnippet += 1;
    } else if (kind === 'removed') {
      curOrig += 1;
    } else {
      curOrig += 1;
      curMod += 1;
      curSnippet += 1;
    }
  }

  hunk.snippetStartLine = startSnippetLine;
  hunk.firstChangedLineModified = firstChangedMod ?? hunk.startLineModified;
  hunk.firstChangedLineOriginal = firstChangedOrig ?? hunk.startLineOriginal;
  hunk.firstChangedSnippetLine = firstChangedSnippet ?? startSnippetLine;
  return curSnippet;
}

/** How many lines of the modified file a hunk shows: its context and added lines. */
export function modifiedLineCount(hunk: DiffHunkAction): number {
  return hunk.lines.reduce((count, line) => {
    const kind = hunkLineKind(line);
    return kind === 'context' || kind === 'added' ? count + 1 : count;
  }, 0);
}

/**
 * Computes the 1-based snippet line where hunk at index `hunkIndex` starts in modified snippet buffer.
 */
export function getHunkSnippetLine(hunkIndex: number, hunks: DiffHunkAction[]): number {
  const stored = hunks[hunkIndex]?.snippetStartLine;
  if (stored !== undefined) return stored;
  let snippetPos = 1;
  for (let i = 0; i < hunkIndex && i < hunks.length; i++) snippetPos += modifiedLineCount(hunks[i]!);
  return snippetPos;
}

/**
 * Maps a 1-based source file line number to the 1-based line number inside a hunk-only snippet buffer.
 * Returns null if the real line falls outside all diff hunks.
 */
export function mapRealLineToSnippetLine(realLine: number, hunks: DiffHunkAction[]): number | null {
  for (let index = 0; index < hunks.length; index++) {
    const hunk = hunks[index]!;
    let currentRealLine = hunk.startLineModified;
    let snippetLine = getHunkSnippetLine(index, hunks);
    for (const line of hunk.lines) {
      const kind = hunkLineKind(line);
      if (kind === 'removed' || kind === 'meta') continue;
      if (currentRealLine === realLine) return snippetLine;
      snippetLine += 1;
      currentRealLine += 1;
    }
  }
  return null;
}

/** The index of the hunk whose shown lines include this snippet line, or -1. */
export function hunkIndexAtSnippetLine(snippetLine: number, hunks: DiffHunkAction[]): number {
  return hunks.findIndex((hunk, index) => {
    const start = getHunkSnippetLine(index, hunks);
    return snippetLine >= start && snippetLine <= start + Math.max(modifiedLineCount(hunk), 1) - 1;
  });
}

/**
 * Computes the 1-based snippet line of the first changed (added/deleted) line
 * for the hunk at index `hunkIndex`. Falls back to the hunk start snippet line.
 */
export function getHunkFirstChangedSnippetLine(hunkIndex: number, hunks: DiffHunkAction[]): number {
  const hunk = hunks[hunkIndex];
  if (!hunk) return 1;
  if (hunk.firstChangedSnippetLine !== undefined) return hunk.firstChangedSnippetLine;
  let currentSnippet = getHunkSnippetLine(hunkIndex, hunks);
  for (const line of hunk.lines) {
    const kind = hunkLineKind(line);
    if (kind === 'added' || kind === 'removed') return currentSnippet;
    if (kind === 'context') currentSnippet += 1;
  }
  return getHunkSnippetLine(hunkIndex, hunks);
}

export const getFirstChangedSnippetLine = getHunkFirstChangedSnippetLine;

/**
 * Returns the first changed modified line number for a hunk.
 * Falls back to startLineModified if no changes are detected.
 */
export function getHunkFirstChangedLineModified(hunk: DiffHunkAction): number {
  if (hunk.firstChangedLineModified !== undefined) return hunk.firstChangedLineModified;
  let curMod = hunk.startLineModified;
  for (const line of hunk.lines) {
    const kind = hunkLineKind(line);
    if (kind === 'added' || kind === 'removed') return Math.max(1, curMod);
    if (kind === 'context') curMod += 1;
  }
  return hunk.startLineModified;
}

export const getFirstChangedLineModified = getHunkFirstChangedLineModified;

/**
 * Returns the first changed original line number for a hunk.
 * Falls back to startLineOriginal if no changes are detected.
 */
export function getHunkFirstChangedLineOriginal(hunk: DiffHunkAction): number {
  if (hunk.firstChangedLineOriginal !== undefined) return hunk.firstChangedLineOriginal;
  let curOrig = hunk.startLineOriginal;
  for (const line of hunk.lines) {
    const kind = hunkLineKind(line);
    if (kind === 'added' || kind === 'removed') return curOrig;
    if (kind === 'context') curOrig += 1;
  }
  return hunk.startLineOriginal;
}

export const getFirstChangedLineOriginal = getHunkFirstChangedLineOriginal;
