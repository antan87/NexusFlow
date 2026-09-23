import React, { useState, useMemo, useEffect, useCallback } from 'react';

import {
  FolderGit2,
  RefreshCw,
  Check,
  Save,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  ListTree,
  ExternalLink,
  Navigation,
} from 'lucide-react';
import type { Feature } from '../../types.js';
import { API_BASE } from '../../lib/apiBase.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Spinner } from '../../components/ui/spinner.js';
import { StatusBadge } from '../../components/ui/status-badge.js';
import { cn } from '../../lib/utils.js';
import { FileTree } from './FileTree.js';
import { PluggableDiffViewer } from './PluggableDiffViewer.js';
import { DiffErrorBoundary } from './DiffErrorBoundary.js';
import { ChangesetSymbolNavigator } from './ChangesetSymbolNavigator.js';
import {
  globalChangesetSymbolIndex,
  useChangesetSymbolStore,
  type ChangesetSymbol,
  type RawAstSymbol,
} from './utils/changesetSymbolIndex.js';
import { parseUnifiedDiff } from './utils/diffParser.js';
import { openInVsCodeAtLine, getEditorLabel } from './adapters/ExternalDiffLauncher.js';
import { useConfig } from '../../lib/api/queries.js';
import { useCockpitStore } from '../cockpit/cockpitStore.js';
import { floatingChatStore } from '../chat/floatingChatStore.js';

interface ChangesViewerProps {
  ws: Feature;
  gitChanges: any[];
  gitChangesLoading: boolean;
  syncLoading: boolean;
  syncResults: any[] | null;
  commitMessage: string;
  showCommitModal: boolean;
  commitLoading: boolean;
  commitResults: any[] | null;
  setSyncResults: (val: any[] | null) => void;
  setCommitResults: (val: any[] | null) => void;
  setCommitMessage: (val: string) => void;
  setShowCommitModal: (val: boolean) => void;
  fetchGitChanges: (wsId: string) => Promise<void>;
  handleSyncAll: (wsId: string) => Promise<void>;
  handleCommitAll: (wsId: string) => Promise<void>;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const ChangesViewer: React.FC<ChangesViewerProps> = ({
  ws,
  gitChanges,
  gitChangesLoading,
  syncLoading,
  syncResults,
  commitMessage,
  showCommitModal,
  commitLoading,
  commitResults,
  setSyncResults,
  setCommitResults,
  setCommitMessage,
  setShowCommitModal,
  fetchGitChanges,
  handleSyncAll,
  handleCommitAll,
  showToast,
}) => {
  // Collapsed repositories state: default to TRUE (collapsed) so user isn't overwhelmed
  const [collapsedRepos, setCollapsedRepos] = useState<Record<string, boolean>>({});
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [diffCache, setDiffCache] = useState<Record<string, string>>({});
  const [fileContentCache, setFileContentCache] = useState<Record<string, string>>({});
  const [originalContentCache, setOriginalContentCache] = useState<Record<string, string>>({});
  const [symbolsCache, setSymbolsCache] = useState<Record<string, RawAstSymbol[]>>({});
  const [diffLoading, setDiffLoading] = useState<Record<string, boolean>>({});
  const [diffErrors, setDiffErrors] = useState<Record<string, string>>({});
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [revealFile, setRevealFile] = useState<string>('');
  const [revealKey, setRevealKey] = useState(0);
  const [targetLineMap, setTargetLineMap] = useState<Record<string, number>>({});
  const [globalSymbolsOpen, setGlobalSymbolsOpen] = useState(false);

  const config = useConfig().data?.config;
  const cockpit = useCockpitStore();
  const defaultEditor = config?.defaultEditor;
  const editorLabel = getEditorLabel(defaultEditor);

  // Subscribe reactively to the global symbol store
  const allIndexedSymbols = useChangesetSymbolStore();

  const reposWithChanges = gitChanges.filter((repo) => repo.files && repo.files.length > 0);
  const totalFilesAcrossRepos = reposWithChanges.reduce((sum, r) => sum + r.files.length, 0);

  // Reset cache and symbols when active workspace changes
  useEffect(() => {
    setDiffCache({});
    setFileContentCache({});
    setOriginalContentCache({});
    setSymbolsCache({});
    setExpandedFiles({});
    setDiffErrors({});
    setTargetLineMap({});
    globalChangesetSymbolIndex.clear();
  }, [ws.branchName]);

  // Load symbols across all modified workspace files in a single fast batch call
  useEffect(() => {
    if (!gitChanges || gitChanges.length === 0) {
      globalChangesetSymbolIndex.clear();
      return;
    }

    let cancelled = false;

    // Collect all valid repo/file pairs currently in gitChanges
    const activeFileKeys = new Set<string>();
    for (const repo of gitChanges) {
      for (const f of repo.files || []) {
        activeFileKeys.add(`${repo.repoName}/${f.file}`);
      }
    }

    // Prune symbols for files no longer in gitChanges
    for (const sym of globalChangesetSymbolIndex.getAllSymbols()) {
      if (!activeFileKeys.has(`${sym.repoName}/${sym.filePath}`)) {
        globalChangesetSymbolIndex.removeFile(sym.repoName, sym.filePath);
      }
    }

    const loadWorkspaceSymbols = async () => {
      try {
        const encodedId = encodeURIComponent(ws.branchName);
        const res = await fetch(`${API_BASE}/api/workspace/${encodedId}/changes/symbols`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.symbols && Array.isArray(data.symbols)) {
            // Group symbols by repo/filePath and batch index into store
            const byFile: Record<string, { repoName: string; filePath: string; repoPath?: string; symbols: any[] }> = {};
            for (const s of data.symbols) {
              const key = `${s.repoName}/${s.filePath}`;
              if (!byFile[key]) {
                byFile[key] = { repoName: s.repoName, filePath: s.filePath, repoPath: s.repoPath, symbols: [] };
              }
              byFile[key].symbols.push(s);
            }

            for (const item of Object.values(byFile)) {
              if (cancelled) break;
              setSymbolsCache((prev) => ({ ...prev, [`${item.repoName}/${item.filePath}`]: item.symbols }));
              globalChangesetSymbolIndex.indexFile(
                item.repoName,
                item.filePath,
                '',
                [],
                item.repoPath,
                item.symbols
              );
            }
          }
        }
      } catch {
        // Ignore network errors in background symbol prefetch
      }
    };

    void loadWorkspaceSymbols();

    return () => {
      cancelled = true;
    };
  }, [gitChanges, ws.branchName]);

  // Flattened list of all files across all repos for multi-file jump bar and keyboard navigation
  const allFiles = useMemo(() => {
    const list: { repoName: string; repoPath: string; file: string; type: string; additions: number; deletions: number }[] = [];
    for (const repo of reposWithChanges) {
      for (const f of repo.files || []) {
        list.push({
          repoName: repo.repoName,
          repoPath: repo.repoPath,
          file: f.file,
          type: f.type,
          additions: f.additions || 0,
          deletions: f.deletions || 0,
        });
      }
    }
    return list;
  }, [reposWithChanges]);

  const isRepoCollapsed = (repoName: string): boolean => {
    return collapsedRepos[repoName] ?? true;
  };

  const toggleRepoCollapse = (repoName: string) => {
    setCollapsedRepos((prev) => ({
      ...prev,
      [repoName]: !isRepoCollapsed(repoName),
    }));
  };

  const expandAllRepos = () => {
    const next: Record<string, boolean> = {};
    gitChanges.forEach((repo) => {
      next[repo.repoName] = false;
    });
    setCollapsedRepos(next);
  };

  const collapseAllRepos = () => {
    const next: Record<string, boolean> = {};
    gitChanges.forEach((repo) => {
      next[repo.repoName] = true;
    });
    setCollapsedRepos(next);
    setExpandedFiles({});
  };

  const toggleFileExpansion = useCallback(
    async (repoName: string, fileName: string) => {
      const cacheKey = `${repoName}/${fileName}`;
      const newExpanded = !expandedFiles[cacheKey];
      setExpandedFiles((prev) => ({ ...prev, [cacheKey]: newExpanded }));

      if (newExpanded && !diffCache[cacheKey]) {
        setDiffLoading((prev) => ({ ...prev, [cacheKey]: true }));
        setDiffErrors((prev) => ({ ...prev, [cacheKey]: '' }));
        try {
          const encodedId = encodeURIComponent(ws.branchName);
          const encodedRepo = encodeURIComponent(repoName);
          const encodedFile = encodeURIComponent(fileName);
          const res = await fetch(
            `${API_BASE}/api/workspace/${encodedId}/changes/diff?repo=${encodedRepo}&file=${encodedFile}`
          );
          if (!res.ok) {
            throw new Error(`Failed to load diff: ${res.statusText}`);
          }
          const data = await res.json();
          setDiffCache((prev) => ({ ...prev, [cacheKey]: data.diff || '' }));
          if (data.fileContent) {
            setFileContentCache((prev) => ({ ...prev, [cacheKey]: data.fileContent }));
          }
          if (data.originalContent) {
            setOriginalContentCache((prev) => ({ ...prev, [cacheKey]: data.originalContent }));
          }
          if (data.symbols) {
            setSymbolsCache((prev) => ({ ...prev, [cacheKey]: data.symbols }));
          }
          if (data.diff) {
            const parsed = parseUnifiedDiff(data.diff);
            const contentToIndex = data.fileContent || parsed.modifiedContent;
            const repoObj = gitChanges.find((r) => r.repoName === repoName);
            globalChangesetSymbolIndex.indexFile(
              repoName,
              fileName,
              contentToIndex,
              parsed.hunks,
              repoObj?.repoPath,
              data.symbols
            );
          }
        } catch (err: any) {
          setDiffErrors((prev) => ({ ...prev, [cacheKey]: err.message || 'Unknown error' }));
        } finally {
          setDiffLoading((prev) => ({ ...prev, [cacheKey]: false }));
        }
      }
    },
    [expandedFiles, diffCache, ws.branchName, gitChanges]
  );

  // Jump to a specific file in the changeset and optionally reveal a line
  const jumpToFile = useCallback(
    async (index: number, line?: number) => {
      if (index < 0 || index >= allFiles.length) return;
      setSelectedFileIndex(index);
      const target = allFiles[index];
      setRevealFile(`${target.repoName}/${target.file}`);
      setRevealKey(value => value + 1);
      const cacheKey = `${target.repoName}/${target.file}`;

      // Ensure repo is expanded
      setCollapsedRepos((prev) => ({ ...prev, [target.repoName]: false }));

      // Set target line BEFORE expansion so PluggableDiffViewer receives initialTargetLine immediately
      if (line !== undefined) {
        setTargetLineMap((prev) => ({ ...prev, [cacheKey]: line }));
      }

      // Ensure file is expanded
      if (!expandedFiles[cacheKey]) {
        await toggleFileExpansion(target.repoName, target.file);
      }

      // Scroll to file in DOM
      const cleanId = `file-diff-${target.repoName}-${target.file.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      setTimeout(() => {
        const elem = document.getElementById(cleanId);
        if (elem) {
          elem.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
    },
    [allFiles, expandedFiles, toggleFileExpansion]
  );


  // Handle Cross-File Definition Jumps from Monaco registerEditorOpener or Symbol Navigator
  const handleCrossFileOpen = (targetRepo: string, targetFile: string, line?: number) => {
    const cleanTarget = targetFile.replace(/\\/g, '/').replace(/^\//, '');
    const index = allFiles.findIndex((f) => {
      const cleanF = f.file.replace(/\\/g, '/').replace(/^\//, '');
      const repoMatches = f.repoName === targetRepo || targetRepo === 'workspace' || !targetRepo;
      return repoMatches && (cleanF === cleanTarget || cleanF.endsWith(cleanTarget) || cleanTarget.endsWith(cleanF));
    });

    if (index !== -1) {
      void jumpToFile(index, line);
      showToast?.(`Navigated to ${targetFile}${line ? `:${line}` : ''}`, 'info');
    } else {
      showToast?.(`Opening ${targetFile}${line ? `:${line}` : ''} in ${editorLabel}`, 'info');
      const matchedRepo = gitChanges.find((r) => r.repoName === targetRepo);
      const targetRepoPath = matchedRepo?.repoPath || (ws.repos && ws.repos.find((p: string) => p.endsWith(targetRepo))) || targetRepo;
      openInVsCodeAtLine(targetRepoPath, targetFile, line || 1, 1, defaultEditor);
    }
  };

  // Keyboard navigation shortcuts: Alt+Down (next file) and Alt+Up (prev file)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'Down')) {
        e.preventDefault();
        if (allFiles.length > 0) {
          const nextIdx = (selectedFileIndex + 1) % allFiles.length;
          void jumpToFile(nextIdx);
        }
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'Up')) {
        e.preventDefault();
        if (allFiles.length > 0) {
          const prevIdx = (selectedFileIndex - 1 + allFiles.length) % allFiles.length;
          void jumpToFile(prevIdx);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFileIndex, allFiles, jumpToFile]);


  const activeSelectedFile = allFiles[selectedFileIndex] || null;

  return (
    <div className="animate-fade-in">
      <header className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <FolderGit2 size={16} className="text-primary" /> Active Workspace Git Diffs
          </h4>
          {reposWithChanges.length > 0 && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-border/80">
              <Button
                variant="ghost"
                size="xs"
                onClick={collapseAllRepos}
                title="Collapse all repositories and file diffs"
                className="text-xs text-muted-foreground hover:text-foreground h-7 px-2 gap-1 font-semibold"
              >
                <ChevronsDownUp size={12} />
                <span>Collapse All</span>
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={expandAllRepos}
                title="Expand all repositories"
                className="text-xs text-muted-foreground hover:text-foreground h-7 px-2 gap-1 font-semibold"
              >
                <ChevronsUpDown size={12} />
                <span>Expand All</span>
              </Button>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchGitChanges(ws.branchName)}
            disabled={gitChangesLoading}
          >
            <RefreshCw size={11} className={gitChangesLoading ? 'animate-spin text-primary' : ''} /> Refresh Changes
          </Button>
          {ws.mode !== 'in-place' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSyncAll(ws.branchName)}
              disabled={syncLoading}
            >
              {syncLoading ? <Spinner className="size-3" /> : <RefreshCw size={11} />} Sync All
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => setShowCommitModal(true)}
            disabled={totalFilesAcrossRepos === 0 || commitLoading}
          >
            Commit & Push All
          </Button>
        </div>
      </header>

      {/* ─── QUICK MULTI-FILE JUMP BAR ─────────────────────────────────────────── */}
      {allFiles.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/90 bg-card/75 p-2.5 px-3.5 backdrop-blur-md shadow-xs select-none">
          <div className="flex items-center gap-2 min-w-0">
            <span className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary shrink-0">
              <Navigation size={12} />
            </span>
            <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-foreground">
              <span>File</span>
              <span className="rounded bg-primary/15 border border-primary/25 px-1.5 py-0.2 text-primary">
                {selectedFileIndex + 1}
              </span>
              <span className="text-muted-foreground">of {allFiles.length}</span>
            </div>

            {/* Quick File Selector Dropdown */}
            <select
              value={selectedFileIndex}
              onChange={(e) => void jumpToFile(Number(e.target.value))}
              className="ml-2 max-w-[240px] sm:max-w-[360px] rounded-lg border border-border bg-background/80 px-2 py-1 font-mono text-[11px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary truncate"
            >
              {allFiles.map((f, i) => (
                <option key={`${f.repoName}/${f.file}`} value={i}>
                  [{f.type.slice(0, 3)}] {f.repoName}: {f.file} (+{f.additions} -{f.deletions})
                </option>
              ))}
            </select>
          </div>

          {/* Jump Bar Navigation Controls & Global Symbols Toggle */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Prev File Button (Alt+Up) */}
            <button
              type="button"
              onClick={() => {
                const prevIdx = (selectedFileIndex - 1 + allFiles.length) % allFiles.length;
                void jumpToFile(prevIdx);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border bg-card hover:bg-accent font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Jump to previous modified file (Shortcut: Alt+Up)"
            >
              <ChevronUp size={12} />
              <span className="hidden sm:inline">Prev (Alt+↑)</span>
            </button>

            {/* Next File Button (Alt+Down) */}
            <button
              type="button"
              onClick={() => {
                const nextIdx = (selectedFileIndex + 1) % allFiles.length;
                void jumpToFile(nextIdx);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border bg-card hover:bg-accent font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Jump to next modified file (Shortcut: Alt+Down)"
            >
              <ChevronDown size={12} />
              <span className="hidden sm:inline">Next (Alt+↓)</span>
            </button>

            {/* Global Changeset Symbols Palette Toggle */}
            <button
              type="button"
              onClick={() => setGlobalSymbolsOpen((prev) => !prev)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded border font-mono text-[10px] transition-colors cursor-pointer',
                globalSymbolsOpen
                  ? 'border-primary/50 bg-primary/15 text-primary font-bold'
                  : 'border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground'
              )}
              title="Toggle Global Changeset Symbol Explorer"
            >
              <ListTree size={12} />
              <span>Symbols ({allIndexedSymbols.length})</span>
            </button>

            {/* Open Current File in Desktop Editor */}
            {activeSelectedFile && (
              <button
                type="button"
                onClick={() => {
                  openInVsCodeAtLine(activeSelectedFile.repoPath, activeSelectedFile.file, 1, 1, defaultEditor);
                  showToast?.(`Opened ${activeSelectedFile.file} in ${editorLabel}`, 'success');
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border bg-card hover:bg-accent font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title={`Open selected file in desktop ${editorLabel}`}
              >
                <ExternalLink size={11} />
                <span className="hidden sm:inline">{editorLabel}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── GLOBAL CHANGESET SYMBOLS PALETTE ──────────────────────────────────── */}
      {globalSymbolsOpen && (
        <div className="mb-5">
          <ChangesetSymbolNavigator
            symbols={allIndexedSymbols}
            activeFilePath={activeSelectedFile?.file}
            editorLabel={editorLabel}
            onSelectSymbol={(sym: ChangesetSymbol) => {
              handleCrossFileOpen(sym.repoName, sym.filePath, sym.lineNumber);
            }}
            onOpenInVsCode={(sym: ChangesetSymbol) => {
              const fileObj = allFiles.find((f) => f.repoName === sym.repoName && f.file === sym.filePath)
                || allFiles.find((f) => f.file === sym.filePath);
              const targetRepoPath = sym.repoPath || fileObj?.repoPath || gitChanges.find((r) => r.repoName === sym.repoName)?.repoPath || sym.repoName;
              openInVsCodeAtLine(targetRepoPath, sym.filePath, sym.lineNumber, sym.column, defaultEditor);
              showToast?.(`Opened ${sym.filePath}:${sym.lineNumber} in ${editorLabel}`, 'success');
            }}
            onClose={() => setGlobalSymbolsOpen(false)}
          />
        </div>
      )}

      {/* Sync Results Banner */}
      {syncResults && ws.mode !== 'in-place' && (
        <div className="relative mb-5 rounded-xl border border-info/25 bg-info/10 p-5 text-info-foreground shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b border-info/20 pb-2">
            <h5 className="font-mono text-xs font-bold text-foreground">Rebase / Sync Action Logs</h5>
            <button
              className="cursor-pointer text-[10px] font-bold text-info-foreground hover:text-foreground"
              onClick={() => setSyncResults(null)}
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-2">
            {syncResults.map((r: any) => (
              <div
                key={r.repoName}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-2 font-mono text-[10px]"
              >
                <span className="font-semibold text-foreground">{r.repoName}</span>
                <span className={r.success ? 'font-bold text-success-foreground' : 'font-bold text-destructive-foreground'}>
                  {r.success ? `✓ Synced (${r.message})` : `✗ Conflict: ${r.message}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Commit Results Banner */}
      {commitResults && (
        <div className="relative mb-5 rounded-xl border border-success/25 bg-success/10 p-5 text-success-foreground shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b border-success/20 pb-2">
            <h5 className="font-mono text-xs font-bold text-foreground">Commit & Push Results</h5>
            <button
              className="cursor-pointer text-[10px] font-bold text-success-foreground hover:text-foreground"
              onClick={() => setCommitResults(null)}
            >
              Dismiss
            </button>
          </div>
          <div className="space-y-2">
            {commitResults.map((r: any) => (
              <div
                key={r.repoName}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-2 font-mono text-[10px]"
              >
                <span className="font-semibold text-foreground">{r.repoName}</span>
                <span className={r.success ? 'font-bold text-success-foreground' : 'font-bold text-destructive-foreground'}>
                  {r.success
                    ? `✓ Committed ${r.filesChanged} file(s) (${r.commitHash ? r.commitHash.slice(0, 7) : 'no hash'})`
                    : `✗ Error: ${r.message}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Commit Panel */}
      {showCommitModal && (
        <div className="relative mb-6 rounded-xl border border-border bg-card p-6 shadow-sm animate-rise">
          <h5 className="mb-3 flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Save size={13} className="text-primary" /> Enter Commit Message
          </h5>
          <Input
            type="text"
            className="mb-4 font-mono text-xs"
            placeholder="feat: implement multi-repo logic..."
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commitMessage.trim()) handleCommitAll(ws.branchName);
            }}
          />
          <div className="flex justify-end gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowCommitModal(false);
                setCommitMessage('');
              }}
              disabled={commitLoading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => handleCommitAll(ws.branchName)}
              disabled={commitLoading || !commitMessage.trim()}
            >
              {commitLoading ? <Spinner className="size-3" /> : null}
              {commitLoading ? 'Committing...' : 'Commit & Push All'}
            </Button>
          </div>
        </div>
      )}

      {gitChangesLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="size-6 text-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {reposWithChanges.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16 text-center shadow-xs">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-success/25 bg-success/10 text-success-foreground shadow-sm">
                <Check size={20} />
              </div>
              <h5 className="text-sm font-bold text-foreground">No Uncommitted Changes</h5>
              <p className="mt-1 text-xs text-muted-foreground">
                Workspace repositories are completely in sync with Git feature branches.
              </p>
            </div>
          ) : (
            reposWithChanges.map((repo) => {
              const totalFilesChanged = repo.files.length;
              const repoAdditions = repo.files.reduce((acc: number, f: any) => acc + (f.additions || 0), 0);
              const repoDeletions = repo.files.reduce((acc: number, f: any) => acc + (f.deletions || 0), 0);
              const collapsed = isRepoCollapsed(repo.repoName);

              return (
                <div
                  key={repo.repoName}
                  className="relative rounded-xl border border-border/80 bg-card/80 backdrop-blur-md transition-all shadow-xs overflow-hidden"
                >
                  {/* Collapsible Repository Header Banner */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleRepoCollapse(repo.repoName)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleRepoCollapse(repo.repoName);
                      }
                    }}
                    className={cn(
                      'flex justify-between items-center px-5 py-4 cursor-pointer select-none transition-colors',
                      collapsed
                        ? 'hover:bg-accent/40'
                        : 'bg-muted/20 border-b border-border/60 hover:bg-muted/30'
                    )}
                  >
                    <div className="flex items-center gap-3 flex-wrap min-w-0">
                      <span className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary border border-primary/20 shrink-0">
                        {collapsed ? (
                          <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronDown size={14} className="shrink-0 text-primary" />
                        )}
                      </span>
                      <h5 className="font-mono text-sm font-bold text-foreground truncate">{repo.repoName}</h5>
                      <StatusBadge tone="warning" dot={false}>
                        {totalFilesChanged} file{totalFilesChanged === 1 ? '' : 's'} changed
                      </StatusBadge>
                      {(repoAdditions > 0 || repoDeletions > 0) && (
                        <span className="rounded-md border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] font-bold">
                          <span className="font-bold text-success-foreground">+{repoAdditions}</span>{' '}
                          <span className="font-bold text-destructive-foreground">-{repoDeletions}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className="max-w-[280px] truncate font-mono text-[10px] text-muted-foreground hidden md:inline"
                        title={repo.repoPath}
                      >
                        {repo.repoPath}
                      </span>
                      <span className="text-[11px] font-bold text-primary hover:underline">
                        {collapsed ? 'Expand Files' : 'Collapse'}
                      </span>
                    </div>
                  </div>

                  {/* Collapsible File List Body */}
                  {!collapsed && (
                    <div className="p-5 flex flex-col gap-3 bg-card/40">
                      <FileTree label={`${repo.repoName} changed files`} files={repo.files} revealPath={revealFile.startsWith(`${repo.repoName}/`) ? revealFile.slice(repo.repoName.length + 1) : undefined} revealKey={revealKey} renderFile={(fileInfo: any) => {
                        const cacheKey = `${repo.repoName}/${fileInfo.file}`;
                        const isExpanded = !!expandedFiles[cacheKey];
                        const isLoading = !!diffLoading[cacheKey];
                        const fileDiff = diffCache[cacheKey] || '';
                        const error = diffErrors[cacheKey] || '';
                        const cleanDomId = `file-diff-${repo.repoName}-${fileInfo.file.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

                        return (
                          <div
                            key={fileInfo.file}
                            id={cleanDomId}
                            className="overflow-hidden rounded transition-colors"
                          >
                            {/* File Header Row */}
                            <div
                              className="flex cursor-pointer select-none items-center justify-between px-2 py-1.5 transition-colors hover:bg-accent/50"
                              role="button" tabIndex={0} aria-expanded={isExpanded}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void toggleFileExpansion(repo.repoName, fileInfo.file); } }}
                              onClick={() => toggleFileExpansion(repo.repoName, fileInfo.file)}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {isExpanded ? (
                                  <ChevronDown size={14} className="shrink-0 text-primary" />
                                ) : (
                                  <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                                )}
                                <span
                                  className="max-w-[240px] truncate font-mono text-[11px] text-foreground sm:max-w-[480px] font-semibold"
                                  title={fileInfo.file}
                                >
                                  {fileInfo.file.split('/').at(-1)}
                                </span>
                                {(fileInfo.additions > 0 || fileInfo.deletions > 0) && (
                                  <span className="ml-1 shrink-0 font-mono text-[9px] font-bold text-muted-foreground">
                                    <span className="text-success-foreground">+{fileInfo.additions}</span> /{' '}
                                    <span className="text-destructive-foreground">-{fileInfo.deletions}</span>
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2.5 shrink-0">
                                <span
                                  className={`rounded border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${
                                    fileInfo.type === 'added'
                                      ? 'border-success/25 bg-success/10 text-success-foreground'
                                      : fileInfo.type === 'deleted'
                                        ? 'border-destructive/25 bg-destructive/10 text-destructive-foreground'
                                        : 'border-warning/25 bg-warning/10 text-warning-foreground'
                                  }`}
                                >
                                  {fileInfo.type}
                                </span>
                              </div>
                            </div>

                            {/* Diff Details Section */}
                            {isExpanded && (
                              <div className="border-t border-border bg-background p-3">
                                {isLoading ? (
                                  <div className="flex items-center gap-2 p-2 font-mono text-[10px] text-primary">
                                    <Spinner className="size-3" /> Loading diff...
                                  </div>
                                ) : error ? (
                                  <div className="p-2 font-mono text-[10px] text-destructive-foreground">Error: {error}</div>
                                ) : (
                                  <DiffErrorBoundary filePath={fileInfo.file} fallbackContent={fileDiff}>
                                    <PluggableDiffViewer
                                      filePath={fileInfo.file}
                                      repoName={repo.repoName}
                                      repoPath={repo.repoPath}
                                      patchText={fileDiff}
                                      fullFileContent={fileContentCache[cacheKey]}
                                      fullOriginalContent={originalContentCache[cacheKey]}
                                      preExtractedSymbols={symbolsCache[cacheKey]}
                                      defaultEditor={defaultEditor}
                                      viewMode={cockpit.diffViewMode}
                                      onToggleViewMode={cockpit.toggleDiffMode}
                                      onRequestRefine={(hunk, feedback) => {
                                        floatingChatStore.openDraft(ws.branchName, [
                                          `Refine ${repo.repoName}/${fileInfo.file} at line ${hunk.startLineModified}.`,
                                          feedback,
                                          'Selected diff hunk:',
                                          hunk.patchHeader,
                                          ...hunk.lines,
                                        ].join('\n'));
                                      }}
                                      initialTargetLine={targetLineMap[cacheKey]}
                                      onOpenFile={handleCrossFileOpen}
                                      onSelectSymbol={(sym) => {
                                        handleCrossFileOpen(sym.repoName, sym.filePath, sym.lineNumber);
                                      }}
                                      showToast={showToast}
                                    />
                                  </DiffErrorBoundary>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
