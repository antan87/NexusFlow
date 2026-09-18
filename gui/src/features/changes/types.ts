/**
 * Pluggable Diff Reviewer Architecture Contracts
 * File: gui/src/features/changes/types.ts
 */
import type { ReactNode } from 'react';

export type DiffViewMode = 'side-by-side' | 'unified';

export type HunkActionType = 'accept' | 'reject' | 'refine';

export interface DiffHunkAction {
  id: string;
  hunkIndex: number;
  type: HunkActionType;
  startLineOriginal: number;
  lineCountOriginal: number;
  startLineModified: number;
  lineCountModified: number;
  patchHeader: string;
  lines: string[];
}

export interface DiffReviewComment {
  id: string;
  hunkIndex?: number;
  filePath: string;
  line: number;
  side: 'original' | 'modified';
  author: { name: string; isAgent: boolean };
  content: string;
  createdAt: string;
}

export interface DiffAdapterRenderProps {
  filePath: string;
  repoPath?: string;
  worktreePath?: string;
  originalContent: string;
  modifiedContent: string;
  patchText: string;
  viewMode: DiffViewMode;
  ignoreWhitespace: boolean;
  comments?: DiffReviewComment[];
  activeHunkIndex?: number;
  onAcceptHunk?: (action: DiffHunkAction) => Promise<void> | void;
  onRejectHunk?: (action: DiffHunkAction) => Promise<void> | void;
  onRequestRefine?: (action: DiffHunkAction, feedback: string) => Promise<void> | void;
  onAddComment?: (comment: Omit<DiffReviewComment, 'id' | 'createdAt'>) => Promise<void> | void;
  onHunkSelect?: (index: number) => void;
}

export interface IDiffAdapter {
  readonly id: string;
  readonly name: string;
  readonly kind: 'embedded' | 'external';
  readonly isAvailable: () => Promise<boolean> | boolean;
  render?: (props: DiffAdapterRenderProps) => ReactNode;
  launchExternal?: (context: {
    repoPath: string;
    filePath: string;
    baseSha?: string;
    worktreeFilePath?: string;
  }) => Promise<{ success: boolean; pid?: number; error?: string }>;
}
