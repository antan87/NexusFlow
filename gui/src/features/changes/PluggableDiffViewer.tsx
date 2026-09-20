/**
 * PluggableDiffViewer Component: Host container orchestrating the pluggable diff engine,
 * view mode switching, whitespace toggling, external IDE launching, hunk triage controls,
 * and changeset symbol navigation.
 * File: gui/src/features/changes/PluggableDiffViewer.tsx
 */
import React, { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import {
  Columns2,
  ExternalLink,
  Check,
  X,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  MessageSquare,
  ListTree,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import type { DiffViewMode, DiffHunkAction } from './types.js';
import { parseUnifiedDiff, mapRealLineToSnippetLine } from './utils/diffParser.js';
import { FallbackDiffAdapter } from './adapters/FallbackDiffAdapter.js';
import { launchVsCodeDiff, openInVsCodeAtLine, getEditorLabel } from './adapters/ExternalDiffLauncher.js';
import { ChangesetSymbolNavigator } from './ChangesetSymbolNavigator.js';
import {
  globalChangesetSymbolIndex,
  type ChangesetSymbol,
  type RawAstSymbol,
} from './utils/changesetSymbolIndex.js';

const MonacoDiffAdapter = lazy(() => import('./adapters/MonacoDiffAdapter.js').then((module) => ({ default: module.MonacoDiffAdapter })));

export interface PluggableDiffViewerProps {
  filePath: string;
  repoName: string;
  repoPath?: string;
  patchText: string;
  fullFileContent?: string;
  fullOriginalContent?: string;
  defaultEditor?: string | null;
  viewMode?: DiffViewMode;
  initialTargetLine?: number;
  changesetSymbols?: ChangesetSymbol[];
  preExtractedSymbols?: RawAstSymbol[];
  onToggleViewMode?: () => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
  onHunkAction?: (action: DiffHunkAction) => Promise<void> | void;
  onRequestRefine?: (action: DiffHunkAction, feedback: string) => Promise<void> | void;
  onOpenFile?: (repoName: string, filePath: string, line?: number) => void;
  onSelectSymbol?: (symbol: ChangesetSymbol) => void;
}

export const PluggableDiffViewer: React.FC<PluggableDiffViewerProps> = ({
  filePath,
  repoName,
  repoPath = '',
  patchText,
  fullFileContent,
  fullOriginalContent,
  defaultEditor,
  viewMode: controlledViewMode,
  initialTargetLine,
  changesetSymbols,
  preExtractedSymbols,
  onToggleViewMode,
  showToast,
  onHunkAction,
  onRequestRefine,
  onOpenFile,
  onSelectSymbol,
}) => {
  // Local or controlled viewMode
  const [internalViewMode, setInternalViewMode] = useState<DiffViewMode>('side-by-side');
  const viewMode = controlledViewMode ?? internalViewMode;

  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [engine, setEngine] = useState<'monaco' | 'fallback'>('monaco');
  const [activeHunkIndex, setActiveHunkIndex] = useState(0);
  const [hunkStates, setHunkStates] = useState<Record<string, 'accepted' | 'rejected' | 'refining'>>({});
  const [refineModalOpen, setRefineModalOpen] = useState(false);
  const [refineFeedback, setRefineFeedback] = useState('');
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [targetLine, setTargetLine] = useState<number | undefined>(initialTargetLine);
  const [jumpNonce, setJumpNonce] = useState(0);
  const editorLabel = getEditorLabel(defaultEditor);

  // Parse diff into original and modified buffers and hunk metadata
  const parsed = useMemo(() => parseUnifiedDiff(patchText), [patchText]);
  const hunks = parsed.hunks;
  const currentHunk = hunks[activeHunkIndex] || null;

  // Index symbols of this file in the global changeset symbol index
  const [fileSymbols, setFileSymbols] = useState<ChangesetSymbol[]>([]);
  useEffect(() => {
    const contentToIndex = fullFileContent || parsed.modifiedContent;
    setFileSymbols(globalChangesetSymbolIndex.indexFile(
      repoName,
      filePath,
      contentToIndex,
      hunks,
      repoPath,
      preExtractedSymbols
    ));
  }, [repoName, filePath, fullFileContent, parsed.modifiedContent, hunks, repoPath, preExtractedSymbols]);

  // If initialTargetLine changes from parent, sync targetLine and active hunk
  useEffect(() => {
    if (initialTargetLine && initialTargetLine > 0) {
      let targetJumpLine = initialTargetLine;
      if (!fullFileContent) {
        const snippetLine = mapRealLineToSnippetLine(initialTargetLine, hunks);
        if (snippetLine !== null) {
          targetJumpLine = snippetLine;
        }
      }
      setTargetLine(targetJumpLine);
      setJumpNonce((n) => n + 1);
      const matchingIndex = hunks.findIndex(
        (h) =>
          initialTargetLine >= h.startLineModified &&
          initialTargetLine <= h.startLineModified + Math.max(h.lineCountModified, 1) - 1
      );
      if (matchingIndex !== -1) {
        setActiveHunkIndex(matchingIndex);
      }
    }
  }, [initialTargetLine, hunks, fullFileContent]);

  const toggleViewMode = () => {
    if (onToggleViewMode) {
      onToggleViewMode();
    } else {
      setInternalViewMode((prev) => (prev === 'side-by-side' ? 'unified' : 'side-by-side'));
    }
  };

  const handleNextHunk = useCallback(() => {
    if (activeHunkIndex < hunks.length - 1) {
      const nextIdx = activeHunkIndex + 1;
      setActiveHunkIndex(nextIdx);
      if (hunks[nextIdx]) {
        setTargetLine(hunks[nextIdx].startLineModified);
      }
    }
  }, [activeHunkIndex, hunks]);

  const handlePrevHunk = useCallback(() => {
    if (activeHunkIndex > 0) {
      const prevIdx = activeHunkIndex - 1;
      setActiveHunkIndex(prevIdx);
      if (hunks[prevIdx]) {
        setTargetLine(hunks[prevIdx].startLineModified);
      }
    }
  }, [activeHunkIndex, hunks]);

  const handleAcceptHunk = useCallback(async () => {
    if (!currentHunk || !onHunkAction) return;
    await onHunkAction({ ...currentHunk, type: 'accept' });
    setHunkStates((prev) => ({ ...prev, [currentHunk.id]: 'accepted' }));
    showToast?.(`Accepted hunk #${activeHunkIndex + 1}`, 'success');
    handleNextHunk();
  }, [currentHunk, activeHunkIndex, showToast, onHunkAction, handleNextHunk]);

  const handleRejectHunk = useCallback(async () => {
    if (!currentHunk || !onHunkAction) return;
    await onHunkAction({ ...currentHunk, type: 'reject' });
    setHunkStates((prev) => ({ ...prev, [currentHunk.id]: 'rejected' }));
    showToast?.(`Rejected hunk #${activeHunkIndex + 1}`, 'info');
    handleNextHunk();
  }, [currentHunk, activeHunkIndex, showToast, onHunkAction, handleNextHunk]);

  const handleOpenRefineModal = () => {
    setRefineFeedback('');
    setRefineModalOpen(true);
  };

  const handleConfirmRefine = async () => {
    if (!currentHunk || !refineFeedback.trim() || !onRequestRefine) return;
    try {
      await onRequestRefine({ ...currentHunk, type: 'refine' }, refineFeedback.trim());
      setRefineModalOpen(false);
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : 'Could not open refinement in chat.', 'error');
    }
  };

  const handleSymbolSelect = (symbol: ChangesetSymbol) => {
    const cleanCurrent = filePath.replace(/\\/g, '/').replace(/^\//, '');
    if (symbol.filePath === cleanCurrent) {
      let targetJumpLine = symbol.lineNumber;
      if (!fullFileContent) {
        const snippetLine = mapRealLineToSnippetLine(symbol.lineNumber, hunks);
        if (snippetLine !== null) {
          targetJumpLine = snippetLine;
        } else {
          showToast?.(`"${symbol.name}" is outside diff hunks (line ${symbol.lineNumber})`, 'info');
          openInVsCodeAtLine(repoPath, filePath, symbol.lineNumber, symbol.column, defaultEditor);
          return;
        }
      }
      setTargetLine(targetJumpLine);
      setJumpNonce((n) => n + 1);

      // Synchronize active hunk with target symbol
      const matchingHunkIndex = hunks.findIndex(
        (h) =>
          symbol.lineNumber >= h.startLineModified &&
          symbol.lineNumber <= h.startLineModified + Math.max(h.lineCountModified, 1) - 1
      );
      if (matchingHunkIndex !== -1) {
        setActiveHunkIndex(matchingHunkIndex);
      }
    } else {
      // Cross-file jump
      onSelectSymbol?.(symbol);
      onOpenFile?.(symbol.repoName, symbol.filePath, symbol.lineNumber);
    }
  };

  const handleLineSelect = (line: number) => {
    const matchingIndex = hunks.findIndex(
      (h) =>
        line >= h.startLineModified &&
        line <= h.startLineModified + Math.max(h.lineCountModified, 1) - 1
    );
    if (matchingIndex !== -1 && matchingIndex !== activeHunkIndex) {
      setActiveHunkIndex(matchingIndex);
    }
  };

  // Keyboard shortcut listener for fast hunk triage
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (e.key === 'j') {
        handleNextHunk();
      } else if (e.key === 'k') {
        handlePrevHunk();
      } else if (e.key === 'a') {
        void handleAcceptHunk();
      } else if (e.key === 'r') {
        void handleRejectHunk();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNextHunk, handlePrevHunk, handleAcceptHunk, handleRejectHunk]);

  const displayedSymbols = changesetSymbols && changesetSymbols.length > 0 ? changesetSymbols : fileSymbols;

  return (
    <div className="flex flex-col rounded-xl border border-border/80 bg-card/60 backdrop-blur-md overflow-hidden shadow-sm my-2">
      {/* ─── TOP DIFF TOOLBAR ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-muted/20 text-xs">
        {/* File & Hunk Summary */}
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={13} className="text-primary shrink-0" />
          <span className="font-mono text-xs font-semibold text-foreground truncate" title={filePath}>
            {filePath}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.2 rounded border border-border/40">
            {repoName}
          </span>
          {hunks.length > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground/80">
              {hunks.length} {hunks.length === 1 ? 'hunk' : 'hunks'}
            </span>
          )}
        </div>

        {/* View Mode & Engine Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Symbol Explorer Toggle */}
          <button
            type="button"
            onClick={() => setSymbolsOpen((prev) => !prev)}
            className={cn(
              'inline-flex items-center gap-1 font-mono text-[11px] px-2 py-1 rounded border transition-colors cursor-pointer',
              symbolsOpen
                ? 'border-primary/50 bg-primary/15 text-primary font-semibold'
                : 'border-border bg-card/60 hover:bg-accent text-muted-foreground hover:text-foreground'
            )}
            title="Toggle Changeset Symbol Navigator"
          >
            <ListTree size={12} />
            <span>Symbols</span>
            {displayedSymbols.length > 0 && (
              <span className="text-[10px] opacity-75">({displayedSymbols.length})</span>
            )}
          </button>

          {/* Split / Unified Toggle */}
          <button
            type="button"
            onClick={toggleViewMode}
            className="inline-flex items-center gap-1 font-mono text-[11px] px-2 py-1 rounded border border-border bg-card/60 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Toggle between Side-by-Side and Unified Diff view"
          >
            <Columns2 size={12} />
            <span>{viewMode === 'side-by-side' ? 'Split' : 'Unified'}</span>
          </button>

          {/* Whitespace Toggle */}
          <button
            type="button"
            onClick={() => setIgnoreWhitespace((prev) => !prev)}
            className={cn(
              'font-mono text-[11px] px-2 py-1 rounded border transition-colors cursor-pointer',
              ignoreWhitespace
                ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                : 'border-border bg-card/60 text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
            title="Ignore whitespace changes in diff comparison"
          >
            Trim WS: {ignoreWhitespace ? 'ON' : 'OFF'}
          </button>

          {/* Diff Engine Switcher */}
          <button
            type="button"
            onClick={() => setEngine((prev) => (prev === 'monaco' ? 'fallback' : 'monaco'))}
            className="inline-flex items-center gap-1 font-mono text-[11px] px-2 py-1 rounded border border-border bg-card/60 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Toggle between Monaco Diff Editor and Lightweight Fallback"
          >
            <Code2 size={12} />
            <span>{engine === 'monaco' ? 'Monaco' : 'Fallback'}</span>
          </button>

          {/* External Launcher: Open in Desktop Editor Diff */}
          <button
            type="button"
            onClick={async () => {
              const ok = await launchVsCodeDiff(repoPath, filePath, defaultEditor);
              if (ok) {
                showToast?.(`Opened ${filePath} in ${editorLabel} diff`, 'success');
              } else {
                openInVsCodeAtLine(repoPath, filePath, 1, 1, defaultEditor);
                showToast?.(`Opened ${filePath} in ${editorLabel}`, 'info');
              }
            }}
            className="inline-flex items-center gap-1 font-mono text-[11px] px-2 py-1 rounded border border-border bg-card/60 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title={`Open file in desktop ${editorLabel} Diff`}
          >
            <ExternalLink size={12} />
            <span className="hidden sm:inline">{editorLabel}</span>
          </button>
        </div>
      </div>

      {/* ─── CHANGESET SYMBOL EXPLORER DRAWER ─────────────────────────────────── */}
      {symbolsOpen && (
        <div className="p-3 border-b border-border/70 bg-muted/20">
          <ChangesetSymbolNavigator
            symbols={displayedSymbols}
            activeFilePath={filePath}
            activeLine={targetLine || (currentHunk ? currentHunk.startLineModified : undefined)}
            editorLabel={editorLabel}
            onSelectSymbol={handleSymbolSelect}
            onOpenInVsCode={(s) => {
              openInVsCodeAtLine(repoPath, s.filePath, s.lineNumber, s.column, defaultEditor);
              showToast?.(`Opened ${s.filePath}:${s.lineNumber} in ${editorLabel}`, 'success');
            }}
            onClose={() => setSymbolsOpen(false)}
          />
        </div>
      )}

      {/* ─── CENTER DIFF CANVAS ──────────────────────────────────────────────── */}
      <div className="p-2 bg-background/50">
        {engine === 'monaco' ? (
          <Suspense fallback={<div role="status">Loading diff editor…</div>}>
          <MonacoDiffAdapter
            filePath={filePath}
            repoName={repoName}
            repoPath={repoPath}
            originalContent={fullOriginalContent || parsed.originalContent}
            modifiedContent={fullFileContent || parsed.modifiedContent}
            patchText={patchText}
            viewMode={viewMode}
            ignoreWhitespace={ignoreWhitespace}
            height={460}
            targetLine={targetLine}
            jumpNonce={jumpNonce}
            onOpenFile={onOpenFile}
            onLineSelect={handleLineSelect}
          />
          </Suspense>
        ) : (
          <FallbackDiffAdapter
            filePath={filePath}
            repoPath={repoPath}
            originalContent={fullOriginalContent || parsed.originalContent}
            modifiedContent={fullFileContent || parsed.modifiedContent}
            patchText={patchText}
            viewMode={viewMode}
            ignoreWhitespace={ignoreWhitespace}
          />
        )}
      </div>

      {/* ─── BOTTOM HUNK TRIAGE BAR ─────────────────────────────────────────── */}
      {hunks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-border/60 bg-muted/15 text-xs select-none">
          {/* Hunk Navigator Controls */}
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <button
              type="button"
              disabled={activeHunkIndex <= 0}
              onClick={handlePrevHunk}
              className="p-1 rounded border border-border bg-card/60 hover:bg-accent disabled:opacity-35 transition-colors cursor-pointer"
              title="Previous hunk (Shortcut: k)"
            >
              <ChevronLeft size={13} />
            </button>

            <span className="px-1.5 text-muted-foreground">
              Hunk <strong className="text-foreground">{activeHunkIndex + 1}</strong> of {hunks.length}
              {currentHunk && (
                <span className="text-[10px] text-muted-foreground/70 ml-1">
                  (Orig L{currentHunk.startLineOriginal} → Mod L{currentHunk.startLineModified})
                </span>
              )}
            </span>

            <button
              type="button"
              disabled={activeHunkIndex >= hunks.length - 1}
              onClick={handleNextHunk}
              className="p-1 rounded border border-border bg-card/60 hover:bg-accent disabled:opacity-35 transition-colors cursor-pointer"
              title="Next hunk (Shortcut: j)"
            >
              <ChevronRight size={13} />
            </button>

            {/* Current Hunk State Badge */}
            {currentHunk && hunkStates[currentHunk.id] && (
              <span
                className={cn(
                  'font-mono text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ml-1 border',
                  hunkStates[currentHunk.id] === 'accepted'
                    ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                    : hunkStates[currentHunk.id] === 'rejected'
                      ? 'border-rose-500/30 bg-rose-500/15 text-rose-400'
                      : 'border-amber-500/30 bg-amber-500/15 text-amber-400'
                )}
              >
                {hunkStates[currentHunk.id]}
              </span>
            )}
          </div>

          {/* Triage Action Buttons & VS Code Line Jump */}
          <div className="flex items-center gap-2">
            {/* Open Active Hunk in Editor at Line */}
            {currentHunk && (
              <button
                type="button"
                onClick={() => {
                  openInVsCodeAtLine(repoPath, filePath, currentHunk.startLineModified, 1, defaultEditor);
                  showToast?.(`Opened ${filePath}:${currentHunk.startLineModified} in ${editorLabel}`, 'success');
                }}
                className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded border border-border bg-card/60 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title={`Open in desktop ${editorLabel} at modified line ${currentHunk.startLineModified}`}
              >
                <ExternalLink size={11} />
                <span>{editorLabel} :L{currentHunk.startLineModified}</span>
              </button>
            )}

            {/* Accept Hunk */}
            {onHunkAction && <>
            <button
              type="button"
              onClick={() => void handleAcceptHunk()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 transition-colors cursor-pointer shadow-2xs"
              title="Accept this hunk (Shortcut: a)"
            >
              <Check size={12} />
              <span>Accept (a)</span>
            </button>

            {/* Reject Hunk */}
            <button
              type="button"
              onClick={() => void handleRejectHunk()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition-colors cursor-pointer shadow-2xs"
              title="Reject this hunk (Shortcut: r)"
            >
              <X size={12} />
              <span>Reject (r)</span>
            </button>

            {/* Request Refine */}
            </>}
            {onRequestRefine &&
            <button
              type="button"
              onClick={handleOpenRefineModal}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 transition-colors cursor-pointer shadow-2xs"
              title="Prepare refinement instructions in AI chat"
            >
              <RefreshCw size={11} />
              <span>Refine</span>
            </button>
            }
          </div>
        </div>
      )}

      {/* ─── REFINE PROMPT MODAL ────────────────────────────────────────────── */}
      {refineModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-primary" />
                <h3 className="text-xs font-bold text-foreground">
                  Request Refinement for Hunk #{activeHunkIndex + 1}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRefineModalOpen(false)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Add instructions for this hunk. They will open as a draft in AI chat for you to send:
            </p>

            <textarea
              value={refineFeedback}
              onChange={(e) => setRefineFeedback(e.target.value)}
              placeholder="e.g. Ensure null safety when calculating vacation debt..."
              rows={3}
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary resize-none"
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
              <button
                type="button"
                onClick={() => setRefineModalOpen(false)}
                className="px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!refineFeedback.trim()}
                onClick={() => void handleConfirmRefine()}
                className="px-3 py-1 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-lg transition-colors"
              >
                Open in AI chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
