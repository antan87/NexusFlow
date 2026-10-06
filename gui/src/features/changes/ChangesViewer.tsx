import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';

import {
  FolderGit2,
  RefreshCw,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  ListTree,
  ExternalLink,
  Navigation,
  ArrowDownUp,
} from 'lucide-react';
import type { CommitRepoResult, Feature } from '../../types.js';
import { CommitReviewPanel } from './CommitReviewPanel.js';
import { perfMark } from '../../lib/perfMarks.js';
import { FinishPanel } from './FinishPanel.js';
import { API_BASE } from '../../lib/apiBase.js';
import { Button } from '../../components/ui/button.js';
import { IconButton } from '../../components/ui/icon-button.js';
import { Spinner } from '../../components/ui/spinner.js';
import { StatusBadge } from '../../components/ui/status-badge.js';
import { cn } from '../../lib/utils.js';
import {
  FileTree,
  buildCompactedTree,
  getAllDirectoryPaths,
  getAncestorPaths,
  normalizePath,
  treeOrderedFiles as getTreeOrderedFiles,
} from './FileTree.js';
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
import { cacheKeyFor, changeVersion, diffCacheDelta, type FetchedFile } from './utils/changeVersion.js';
import { omittedNotice, type OmittedContent } from './utils/omittedContent.js';
import { findChangedFileIndex, isAbsoluteReference, repoDirName } from './utils/changesetNavigation.js';
import { disposeChangesetModelsAfterEditors } from './utils/changesetModelStore.js';
import { openInVsCodeAtLine, getEditorLabel } from './adapters/ExternalDiffLauncher.js';
import { useConfig } from '../../lib/api/queries.js';
import { useCockpitStore } from '../cockpit/cockpitStore.js';
import { safeCopyToClipboard } from '../../lib/clipboard.js';
import { floatingChatStore } from '../chat/floatingChatStore.js';

/** Store `value` under `key`, or remove the key when there is nothing to store. */
function setOrClear<T>(
  setter: React.Dispatch<React.SetStateAction<Record<string, T>>>,
  key: string,
  value: T | null | undefined | '',
): void {
  setter((prev) => {
    if (value) return { ...prev, [key]: value };
    if (!(key in prev)) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  });
}

interface ChangesViewerProps {
  ws: Feature;
  gitChanges: any[];
  gitChangesLoading: boolean;
  syncLoading: boolean;
  syncResults: any[] | null;
  commitMessage: string;
  showCommitModal: boolean;
  commitResults: CommitRepoResult[] | null;
  setSyncResults: (val: any[] | null) => void;
  setCommitResults: (val: CommitRepoResult[] | null) => void;
  setCommitMessage: (val: string) => void;
  setShowCommitModal: (val: boolean) => void;
  fetchGitChanges: (wsId: string) => Promise<void>;
  handleSyncAll: (wsId: string) => Promise<void>;
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
  commitResults,
  setSyncResults,
  setCommitResults,
  setCommitMessage,
  setShowCommitModal,
  fetchGitChanges,
  handleSyncAll,
  showToast,
}) => {
  // Collapsed repositories state: default to TRUE (collapsed) so user isn't overwhelmed
  const [collapsedRepos, setCollapsedRepos] = useState<Record<string, boolean>>({});
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [diffCache, setDiffCache] = useState<Record<string, string>>({});
  const [fileContentCache, setFileContentCache] = useState<Record<string, string>>({});
  const [originalContentCache, setOriginalContentCache] = useState<Record<string, string>>({});
  const [symbolsCache, setSymbolsCache] = useState<Record<string, RawAstSymbol[]>>({});
  const [omittedCache, setOmittedCache] = useState<Record<string, OmittedContent>>({});
  const [diffLoading, setDiffLoading] = useState<Record<string, boolean>>({});
  const [diffErrors, setDiffErrors] = useState<Record<string, string>>({});
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [revealFile, setRevealFile] = useState<string>('');
  const [revealKey, setRevealKey] = useState(0);
  const [targetLineMap, setTargetLineMap] = useState<Record<string, number>>({});
  const [globalSymbolsOpen, setGlobalSymbolsOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  // What was fetched for each file, and at which version. Bookkeeping only:
  // nothing renders from it, so it lives in a ref.
  const fetchedFiles = useRef<Record<string, FetchedFile>>({});

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
    setOmittedCache({});
    setExpandedFiles({});
    setDiffErrors({});
    setTargetLineMap({});
    setTreeExpandedPaths({});
    fetchedFiles.current = {};
    globalChangesetSymbolIndex.clear();
  }, [ws.branchName]);

  // Leaving the Changes tab (or switching workspace, which remounts this) drops
  // every cached diff, so release the editor models those diffs created too.
  useEffect(() => () => {
    const files = Object.values(fetchedFiles.current);
    fetchedFiles.current = {};
    disposeChangesetModelsAfterEditors(files);
  }, []);

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

  // Flattened list of all files across all repos in deterministic visual tree order
  // for multi-file jump bar, dropdown, and keyboard navigation
  const treeOrderedFiles = useMemo(() => {
    return reposWithChanges.flatMap((repo) =>
      getTreeOrderedFiles(repo.files || []).map((f: any) => ({
        repoName: repo.repoName,
        repoPath: repo.repoPath,
        file: f.file,
        type: f.type || 'modified',
        additions: f.additions || 0,
        deletions: f.deletions || 0,
      }))
    );
  }, [reposWithChanges]);

  useEffect(() => {
    if (treeOrderedFiles.length === 0) {
      if (selectedFileIndex !== 0) setSelectedFileIndex(0);
    } else if (selectedFileIndex >= treeOrderedFiles.length) {
      setSelectedFileIndex(treeOrderedFiles.length - 1);
    } else if (selectedFileIndex < 0) {
      setSelectedFileIndex(0);
    }
  }, [treeOrderedFiles.length, selectedFileIndex]);

  const isRepoCollapsed = (repoName: string): boolean => {
    return collapsedRepos[repoName] ?? true;
  };

  const toggleRepoCollapse = (repoName: string) => {
    setCollapsedRepos((prev) => ({
      ...prev,
      [repoName]: !isRepoCollapsed(repoName),
    }));
  };

  const [treeExpandedPaths, setTreeExpandedPaths] = useState<Record<string, Set<string>>>({});

  const expandAllRepos = () => {
    const next: Record<string, boolean> = {};
    const nextTrees: Record<string, Set<string>> = {};
    gitChanges.forEach((repo) => {
      next[repo.repoName] = false;
      const root = buildCompactedTree(repo.files || []);
      nextTrees[repo.repoName] = new Set(getAllDirectoryPaths(root));
    });
    setCollapsedRepos(next);
    setTreeExpandedPaths(nextTrees);
  };

  const collapseAllRepos = () => {
    const next: Record<string, boolean> = {};
    const nextTrees: Record<string, Set<string>> = {};
    gitChanges.forEach((repo) => {
      next[repo.repoName] = true;
      nextTrees[repo.repoName] = new Set();
    });
    setCollapsedRepos(next);
    setExpandedFiles({});
    setTreeExpandedPaths(nextTrees);
  };

  // Smart defaults for changes mode: expanded by default for repos when gitChanges loads
  useEffect(() => {
    if (!gitChanges || gitChanges.length === 0) return;
    setTreeExpandedPaths((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const repo of gitChanges) {
        if (!next[repo.repoName]) {
          changed = true;
          const root = buildCompactedTree(repo.files || []);
          next[repo.repoName] = new Set(getAllDirectoryPaths(root));
        }
      }
      return changed ? next : prev;
    });
  }, [gitChanges]);

  /** The version of a file's change as the current change list describes it. */
  const versionOf = useCallback(
    (repoName: string, fileName: string): string => {
      const entry = gitChanges
        .find((repo) => repo.repoName === repoName)
        ?.files?.find((file: { file: string }) => file.file === fileName);
      return entry ? changeVersion(entry) : '';
    },
    [gitChanges],
  );

  const dropFileCaches = useCallback((keys: ReadonlySet<string>) => {
    const without = <T,>(prev: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => !keys.has(key)));
    setDiffCache(without);
    setFileContentCache(without);
    setOriginalContentCache(without);
    setSymbolsCache(without);
    setOmittedCache(without);
    setDiffErrors(without);
  }, []);

  // `background` refreshes a diff that is already on screen: the viewer keeps
  // showing the old one until the new one arrives, rather than unmounting
  // behind a spinner and rebuilding the editor.
  const loadDiff = useCallback(
    async (repoName: string, fileName: string, version: string, background = false) => {
      const cacheKey = cacheKeyFor(repoName, fileName);
      const previous = fetchedFiles.current[cacheKey];
      const repoPath = gitChanges.find((r) => r.repoName === repoName)?.repoPath;
      fetchedFiles.current[cacheKey] = { repoName, repoPath, file: fileName, version };
      // False once a newer request, or the file leaving the change list, took over.
      const isCurrent = () => fetchedFiles.current[cacheKey]?.version === version;

      if (!background) {
        setDiffLoading((prev) => ({ ...prev, [cacheKey]: true }));
        setDiffErrors((prev) => ({ ...prev, [cacheKey]: '' }));
      }
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
        if (!isCurrent()) return;

        setDiffCache((prev) => ({ ...prev, [cacheKey]: data.diff || '' }));
        perfMark('cs:diff-ready', { panel: 'changes', repo: repoName, file: fileName });
        // Set or clear, never skip: a refresh of a file that became empty must not keep its old content.
        setOrClear(setFileContentCache, cacheKey, data.fileContent);
        setOrClear(setOriginalContentCache, cacheKey, data.originalContent);
        setOrClear(setSymbolsCache, cacheKey, data.symbols);
        setOrClear<OmittedContent>(
          setOmittedCache,
          cacheKey,
          data.contentOmitted || data.diffOmitted ? { content: data.contentOmitted, diff: data.diffOmitted || undefined } : undefined,
        );
        setOrClear(setDiffErrors, cacheKey, '');
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
        if (!isCurrent()) return;
        if (background && previous) {
          // The diff on screen is out of date but was right when fetched. Keep it,
          // and mark it stale again so the next change to the list retries.
          fetchedFiles.current[cacheKey] = previous;
          console.warn(`Could not refresh the diff for ${cacheKey}:`, err);
          return;
        }
        // Opening a file: show the error alone, since there is no diff to keep.
        delete fetchedFiles.current[cacheKey];
        dropFileCaches(new Set([cacheKey]));
        setDiffErrors((prev) => ({ ...prev, [cacheKey]: err.message || 'Unknown error' }));
      } finally {
        // A newer request owns the loading flag while it is in flight.
        if (isCurrent() || !fetchedFiles.current[cacheKey]) {
          setDiffLoading((prev) => ({ ...prev, [cacheKey]: false }));
        }
      }
    },
    [ws.branchName, gitChanges, dropFileCaches]
  );

  // Keep cached diffs honest as the working tree moves: refresh a changed file
  // that is open, drop a changed one that is closed, and forget files that left
  // the change list (committed, reverted, deleted) together with their editor models.
  useEffect(() => {
    const { stale, removed } = diffCacheDelta(fetchedFiles.current, gitChanges ?? []);
    if (stale.length === 0 && removed.length === 0) return;

    const drop = new Set<string>(removed);
    const gonePaths: FetchedFile[] = [];
    for (const key of removed) {
      const entry = fetchedFiles.current[key];
      delete fetchedFiles.current[key];
      if (entry) gonePaths.push(entry);
    }
    disposeChangesetModelsAfterEditors(gonePaths);
    for (const { key, version } of stale) {
      const entry = fetchedFiles.current[key];
      if (!entry) continue;
      if (expandedFiles[key]) {
        void loadDiff(entry.repoName, entry.file, version, true);
      } else {
        delete fetchedFiles.current[key];
        drop.add(key);
      }
    }
    if (drop.size === 0) return;
    dropFileCaches(drop);
    // A file that left the list must not come back already "expanded" with nothing loaded.
    if (removed.length > 0) {
      const gone = new Set(removed);
      setExpandedFiles((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !gone.has(key))));
    }
  }, [gitChanges, expandedFiles, loadDiff, dropFileCaches]);

  const toggleFileExpansion = useCallback(
    async (repoName: string, fileName: string) => {
      const cacheKey = cacheKeyFor(repoName, fileName);
      const newExpanded = !expandedFiles[cacheKey];
      setExpandedFiles((prev) => ({ ...prev, [cacheKey]: newExpanded }));

      if (newExpanded && !diffCache[cacheKey]) {
        await loadDiff(repoName, fileName, versionOf(repoName, fileName));
      }
    },
    [expandedFiles, diffCache, loadDiff, versionOf]
  );

  // Jump to a specific file in the changeset and optionally reveal a line
  const jumpToFile = useCallback(
    async (index: number, line?: number) => {
      if (index < 0 || index >= treeOrderedFiles.length) return;
      setSelectedFileIndex(index);
      const target = treeOrderedFiles[index];
      setRevealFile(`${target.repoName}/${target.file}`);
      setRevealKey(value => value + 1);
      const cacheKey = `${target.repoName}/${target.file}`;

      // Ensure repo is expanded
      setCollapsedRepos((prev) => ({ ...prev, [target.repoName]: false }));

      // Ensure ancestor folders in FileTree are expanded
      const targetRepoObj = gitChanges.find((r) => r.repoName === target.repoName);
      if (targetRepoObj) {
        const root = buildCompactedTree(targetRepoObj.files || []);
        const ancestors = getAncestorPaths(root, target.file);
        if (ancestors.length > 0) {
          setTreeExpandedPaths((prev) => {
            const current = prev[target.repoName] || new Set();
            let changed = false;
            const next = new Set(current);
            for (const a of ancestors) {
              if (!next.has(a)) {
                next.add(a);
                changed = true;
              }
            }
            return changed ? { ...prev, [target.repoName]: next } : prev;
          });
        }
      }

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
    [treeOrderedFiles, expandedFiles, toggleFileExpansion, gitChanges]
  );


  // Handle Cross-File Definition Jumps from Monaco registerEditorOpener or Symbol Navigator
  const handleCrossFileOpen = (targetRepo: string, targetFile: string, line?: number) => {
    const index = findChangedFileIndex(treeOrderedFiles, targetRepo, targetFile);

    if (index !== -1) {
      void jumpToFile(index, line);
      showToast?.(`Navigated to ${targetFile}${line ? `:${line}` : ''}`, 'info');
    } else {
      const matchedRepo = gitChanges.find((r) => r.repoName === targetRepo);
      const targetRepoPath = matchedRepo?.repoPath
        || ws.repos?.find((p: string) => repoDirName(p) === targetRepo);
      // Without a repository to anchor it, a relative path would build a URI to nowhere.
      if (!targetRepoPath && !isAbsoluteReference(targetFile)) {
        showToast?.(`Could not locate ${targetFile} in this workspace`, 'error');
        return;
      }
      showToast?.(`Opening ${targetFile}${line ? `:${line}` : ''} in ${editorLabel}`, 'info');
      openInVsCodeAtLine(targetRepoPath ?? '', targetFile, line || 1, 1, defaultEditor);
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
        if (treeOrderedFiles.length > 0) {
          const nextIdx = (selectedFileIndex + 1) % treeOrderedFiles.length;
          void jumpToFile(nextIdx);
        }
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'Up')) {
        e.preventDefault();
        if (treeOrderedFiles.length > 0) {
          const prevIdx = (selectedFileIndex - 1 + treeOrderedFiles.length) % treeOrderedFiles.length;
          void jumpToFile(prevIdx);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFileIndex, treeOrderedFiles, jumpToFile]);


  const activeSelectedFile = treeOrderedFiles[selectedFileIndex] || null;

  return (
    <div className="animate-fade-in">
      <header className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FolderGit2 size={14} className="text-muted-foreground" /> Active Workspace Git Diffs
          </h4>
          {reposWithChanges.length > 0 && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-border/80">
              <IconButton label="Collapse All" icon={<ChevronsDownUp />} onClick={collapseAllRepos} className="text-muted-foreground hover:text-foreground" />
              <IconButton label="Expand All" icon={<ChevronsUpDown />} onClick={expandAllRepos} className="text-muted-foreground hover:text-foreground" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-0.5">
          <IconButton
            label="Refresh Changes"
            icon={<RefreshCw className={gitChangesLoading ? 'animate-spin text-primary' : ''} />}
            onClick={() => fetchGitChanges(ws.branchName)}
            disabled={gitChangesLoading}
            className="text-muted-foreground hover:text-foreground"
          />
          {ws.mode !== 'in-place' && (
            <IconButton
              label="Sync All"
              icon={syncLoading ? <Spinner className="size-3.5" /> : <ArrowDownUp />}
              onClick={() => handleSyncAll(ws.branchName)}
              disabled={syncLoading}
              className="text-muted-foreground hover:text-foreground"
            />
          )}
          <Button
            variant="outline"
            size="xs"
            className="ml-1.5 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary"
            onClick={() => setShowCommitModal(true)}
            disabled={totalFilesAcrossRepos === 0 || showCommitModal}
          >
            Review & commit
          </Button>
          <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-foreground" onClick={() => setFinishOpen(true)} disabled={finishOpen}>
            Finish…
          </Button>
        </div>
      </header>

      {/* ─── QUICK MULTI-FILE JUMP BAR ─────────────────────────────────────────── */}
      {treeOrderedFiles.length > 0 && (
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
              <span className="text-muted-foreground">of {treeOrderedFiles.length}</span>
            </div>

            {/* Quick File Selector Dropdown */}
            <select
              aria-label="Jump to changed file"
              value={selectedFileIndex}
              onChange={(e) => void jumpToFile(Number(e.target.value))}
              className="ml-2 max-w-[240px] sm:max-w-[360px] rounded-lg border border-border bg-background/80 px-2 py-1 font-mono text-[11px] text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary truncate"
            >
              {treeOrderedFiles.map((f, i) => (
                <option key={`${f.repoName}/${f.file}`} value={i}>
                  [{(f.type || 'modified').slice(0, 3)}] {f.repoName}: {f.file} (+{f.additions} -{f.deletions})
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
                const prevIdx = (selectedFileIndex - 1 + treeOrderedFiles.length) % treeOrderedFiles.length;
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
                const nextIdx = (selectedFileIndex + 1) % treeOrderedFiles.length;
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
              const fileObj = treeOrderedFiles.find((f) => f.repoName === sym.repoName && f.file === sym.filePath)
                || treeOrderedFiles.find((f) => f.file === sym.filePath);
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
            {commitResults.map((r) => (
              <div
                key={r.repoName}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-2 font-mono text-[10px]"
              >
                <span className="font-semibold text-foreground">{r.repoName}</span>
                <span className={r.success ? 'font-bold text-success-foreground' : 'font-bold text-destructive-foreground'}>
                  {r.committed
                    ? `✓ Committed ${r.filesChanged} file(s) (${r.commitHash ? r.commitHash.slice(0, 7) : 'no hash'}) on ${r.branch}${r.pushed ? ', pushed' : ', not pushed'}`
                    : `✗ Error: ${r.message}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {finishOpen && (
        <FinishPanel ws={ws} onClose={() => setFinishOpen(false)} onGitChanged={() => void fetchGitChanges(ws.branchName)} />
      )}

      {/* Reviewed commit: scope, destinations, verification and push decision */}
      {showCommitModal && (
        <CommitReviewPanel
          ws={ws}
          message={commitMessage}
          setMessage={setCommitMessage}
          onClose={() => setShowCommitModal(false)}
          onCompleted={(results) => {
            setCommitResults(results);
            setShowCommitModal(false);
          }}
          onGitChanged={() => void fetchGitChanges(ws.branchName)}
        />
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
                      <FileTree
                        label={`${repo.repoName} changed files`}
                        files={repo.files}
                        revealPath={revealFile.startsWith(`${repo.repoName}/`) ? revealFile.slice(repo.repoName.length + 1) : undefined}
                        revealKey={revealKey}
                        defaultExpanded={true}
                        expandedPaths={treeExpandedPaths[repo.repoName]}
                        onExpandedPathsChange={(paths) => setTreeExpandedPaths(prev => ({ ...prev, [repo.repoName]: paths }))}
                        renderFile={(fileInfo: any) => {
                        const cacheKey = `${repo.repoName}/${fileInfo.file}`;
                        const isExpanded = !!expandedFiles[cacheKey];
                        const isLoading = !!diffLoading[cacheKey];
                        const fileDiff = diffCache[cacheKey] || '';
                        const error = diffErrors[cacheKey] || '';
                        const omitted = omittedCache[cacheKey];
                        const notice = omittedNotice(omitted);
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
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  const idx = treeOrderedFiles.findIndex(
                                    f => f.repoName === repo.repoName && (f.file === fileInfo.file || normalizePath(f.file) === normalizePath(fileInfo.file))
                                  );
                                  if (idx !== -1) setSelectedFileIndex(idx);
                                  void toggleFileExpansion(repo.repoName, fileInfo.file);
                                }
                              }}
                              onClick={() => {
                                const idx = treeOrderedFiles.findIndex(
                                  f => f.repoName === repo.repoName && (f.file === fileInfo.file || normalizePath(f.file) === normalizePath(fileInfo.file))
                                );
                                if (idx !== -1) setSelectedFileIndex(idx);
                                toggleFileExpansion(repo.repoName, fileInfo.file);
                              }}
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
                                  <>
                                  {notice && (
                                    <p role="note" className="mb-2 rounded border border-border/70 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                                      {notice}
                                    </p>
                                  )}
                                  {!omitted?.diff && (
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
                                      onRequestRefine={async (hunk, feedback) => {
                                        const prompt = [
                                          `Refine ${repo.repoName}/${fileInfo.file} at line ${hunk.startLineModified}.`,
                                          feedback,
                                          'Selected diff hunk:',
                                          hunk.patchHeader,
                                          ...hunk.lines,
                                        ].join('\n');
                                        if (!await safeCopyToClipboard(prompt)) throw new Error('Could not copy the refinement request. Check clipboard permissions.');
                                        floatingChatStore.openCli(ws.branchName);
                                        showToast?.('Refinement request copied. Paste it into CLI chat.', 'success');
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
                                  </>
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
