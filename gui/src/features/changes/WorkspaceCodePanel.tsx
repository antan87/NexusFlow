import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { FileCode, RefreshCw, PanelLeft, PanelLeftClose, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, X, Search } from 'lucide-react';
import { apiFetch } from '../../lib/api/client.js';
import { perfMark } from '../../lib/perfMarks.js';
import { Button } from '../../components/ui/button.js';
import { cn } from '../../lib/utils.js';
import {
  FileTree,
  buildCompactedTree,
  filterTreeFiles,
  getAllDirectoryPaths,
  getAncestorPaths,
  getMatchingBranchPaths,
  normalizePath,
  treeOrderedFiles as getTreeOrderedFiles,
} from './FileTree.js';
import { fileTypeGlyph } from './fileTypeGlyph.js';
import { DiffErrorBoundary } from './DiffErrorBoundary.js';
import { PluggableDiffViewer } from './PluggableDiffViewer.js';
import { resolveFileReference } from './resolveFileReference.js';
import { usePaneHotkey } from '../terminal/usePaneHotkey.js';

/**
 * Sidebar width limits. The lower bound keeps the file name readable, and the
 * upper bound stops the tree from crowding out the diff it selects.
 */
const TREE_MIN_PX = 132;
const TREE_MAX_PX = 420;
const TREE_DEFAULT_PX = 208;
const TREE_WIDTH_KEY = 'contextspace.code-panel.tree-width';

interface CodeFile { file: string; type: string; additions?: number; deletions?: number; size?: number; mtimeMs?: number }
interface CodeRepo { repoName: string; repoPath: string; files: CodeFile[]; error?: string }
interface Selection { repoName: string; repoPath: string; file: string; line?: number }
interface FileDiff { diff: string; fileContent?: string; originalContent?: string }

export function WorkspaceCodePanel({
  workspace,
  active,
  openReference,
  onClose,
}: {
  workspace: string;
  active: boolean;
  openReference?: { path: string; line?: number; id: number } | null;
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<'changes' | 'files'>('changes');
  const [repos, setRepos] = useState<CodeRepo[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState('');
  const [diffError, setDiffError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [treeWidth, setTreeWidth] = useState(() => {
    try {
      const stored = typeof localStorage !== 'undefined' ? Number.parseInt(localStorage.getItem(TREE_WIDTH_KEY) ?? '', 10) : Number.NaN;
      return Number.isFinite(stored) ? Math.min(TREE_MAX_PX, Math.max(TREE_MIN_PX, stored)) : TREE_DEFAULT_PX;
    } catch {
      return TREE_DEFAULT_PX;
    }
  });
  const [draggingTree, setDraggingTree] = useState(false);
  const handledReference = useRef(0);
  const plainCode = useRef<HTMLPreElement>(null);
  const scrolledSelectionKey = useRef<string>('');
  const base = `/api/workspace/${encodeURIComponent(workspace)}`;

  const [expandedPathsByRepo, setExpandedPathsByRepo] = useState<Record<string, Set<string>>>({});
  const [collapsedRepos, setCollapsedRepos] = useState<Record<string, boolean>>({});
  const [revealKey, setRevealKey] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchExpandedPathsByRepo, setSearchExpandedPathsByRepo] = useState<Record<string, Set<string>>>({});
  const [searchCollapsedRepos, setSearchCollapsedRepos] = useState<Record<string, boolean>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearchExpandedPathsByRepo({});
    setSearchCollapsedRepos({});
  }, [searchQuery]);

  const totalFilesCount = useMemo(
    () => repos.reduce((sum, repo) => sum + (repo.files?.length || 0), 0),
    [repos]
  );

  const filteredRepos = useMemo(() => {
    if (!searchQuery.trim()) return repos;
    return repos.map(repo => ({
      ...repo,
      files: filterTreeFiles(repo.files || [], searchQuery),
    }));
  }, [repos, searchQuery]);

  const matchingFilesCount = useMemo(
    () => filteredRepos.reduce((sum, repo) => sum + (repo.files?.length || 0), 0),
    [filteredRepos]
  );

  const effectiveExpandedPathsByRepo = useMemo(() => {
    if (!searchQuery.trim()) return expandedPathsByRepo;
    const result: Record<string, Set<string>> = {};
    for (const repo of filteredRepos) {
      if (searchExpandedPathsByRepo[repo.repoName]) {
        result[repo.repoName] = searchExpandedPathsByRepo[repo.repoName];
      } else {
        result[repo.repoName] = getMatchingBranchPaths(repo.files || [], searchQuery, { compact: true });
      }
    }
    return result;
  }, [searchQuery, filteredRepos, expandedPathsByRepo, searchExpandedPathsByRepo]);

  const expandAllFolders = useCallback(() => {
    if (searchQuery.trim()) {
      const next: Record<string, Set<string>> = {};
      for (const repo of filteredRepos) {
        const root = buildCompactedTree(repo.files || []);
        next[repo.repoName] = new Set(getAllDirectoryPaths(root));
      }
      setSearchExpandedPathsByRepo(next);
      setSearchCollapsedRepos({});
      return;
    }
    const next: Record<string, Set<string>> = {};
    for (const repo of repos) {
      const root = buildCompactedTree(repo.files || []);
      next[repo.repoName] = new Set(getAllDirectoryPaths(root));
    }
    setExpandedPathsByRepo(next);
    setCollapsedRepos({});
  }, [repos, searchQuery, filteredRepos]);

  const collapseAllFolders = useCallback(() => {
    if (searchQuery.trim()) {
      const next: Record<string, Set<string>> = {};
      for (const repo of filteredRepos) {
        next[repo.repoName] = new Set();
      }
      setSearchExpandedPathsByRepo(next);
      return;
    }
    const next: Record<string, Set<string>> = {};
    for (const repo of repos) {
      next[repo.repoName] = new Set();
    }
    setExpandedPathsByRepo(next);
  }, [repos, searchQuery, filteredRepos]);

  // Smart defaults for folder expansion: apply ONLY when mode transitions between
  // 'changes' (expanded by default) and 'files' (collapsed by default).
  // Crucially, this must NOT re-run on polling re-renders when repos update.
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current === mode) return;
    prevMode.current = mode;
    setSearchExpandedPathsByRepo({});
    setSearchCollapsedRepos({});
    const next: Record<string, Set<string>> = {};
    for (const repo of repos) {
      if (mode === 'changes') {
        const root = buildCompactedTree(repo.files || []);
        next[repo.repoName] = new Set(getAllDirectoryPaths(root));
      } else {
        next[repo.repoName] = new Set();
      }
    }
    setExpandedPathsByRepo(next);
  }, [mode, repos]);

  // When repos load initially, populate default expansion for repos not yet tracked
  useEffect(() => {
    if (repos.length === 0) return;
    setExpandedPathsByRepo(prev => {
      let changed = false;
      const next = { ...prev };
      for (const repo of repos) {
        if (!next[repo.repoName]) {
          changed = true;
          if (mode === 'changes') {
            const root = buildCompactedTree(repo.files || []);
            next[repo.repoName] = new Set(getAllDirectoryPaths(root));
          } else {
            next[repo.repoName] = new Set();
          }
        }
      }
      return changed ? next : prev;
    });
  }, [repos, mode]);

  // When a file is selected or revealed, ensure its repo is not collapsed and its ancestors are auto-expanded.
  // Note: we track lastSelectedKey so manual collapses of the repo do NOT get snapped back open.
  const lastSelectedKey = useRef<string>('');
  useEffect(() => {
    if (!selection) return;
    const key = `${selection.repoName}:${selection.file}:${revealKey}`;
    if (key === lastSelectedKey.current) return;
    lastSelectedKey.current = key;

    setCollapsedRepos(prev => (prev[selection.repoName] ? { ...prev, [selection.repoName]: false } : prev));
    setSearchCollapsedRepos(prev => (prev[selection.repoName] ? { ...prev, [selection.repoName]: false } : prev));

    const repo = repos.find(r => r.repoName === selection.repoName);
    if (!repo) return;
    const root = buildCompactedTree(repo.files || []);
    const ancestors = getAncestorPaths(root, selection.file);
    if (ancestors.length > 0) {
      setExpandedPathsByRepo(prev => {
        const current = prev[selection.repoName] || new Set();
        let changed = false;
        const next = new Set(current);
        for (const a of ancestors) {
          if (!next.has(a)) {
            next.add(a);
            changed = true;
          }
        }
        return changed ? { ...prev, [selection.repoName]: next } : prev;
      });
    }
  }, [selection, repos, revealKey]);

  useEffect(() => {
    if (openReference && openReference.id !== handledReference.current) {
      if (searchQuery) {
        setSearchQuery('');
      }
    }
  }, [openReference, searchQuery]);

  // Refresh every 10 s while the panel is on screen. A hidden window does no
  // work at all, and catches up once as soon as it is shown again.
  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const start = () => { timer ??= window.setInterval(() => setRevision(value => value + 1), 10_000); };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        setRevision(value => value + 1);
        start();
      }
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [active]);

  // The server answers a refresh with `unchanged` when this token is current,
  // so an idle panel does not re-download (and re-compare) the whole tree.
  const knownListing = useRef<{ key: string; token: string } | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    // Only a plain refresh may reuse the listing; a new mode, workspace or
    // file reference needs the full result.
    const key = `${base}|${mode}|${openReference?.id ?? ''}`;
    const known = knownListing.current?.key === key ? knownListing.current.token : null;
    const needAll = mode === 'files' || !!(openReference && openReference.id !== handledReference.current);
    const params = new URLSearchParams(needAll ? { include: 'all' } : {});
    if (known) params.set('known', known);
    const query = params.toString();
    void apiFetch<{ changes?: CodeRepo[]; unchanged?: boolean; token?: string }>(`${base}/changes${query ? `?${query}` : ''}`)
      .then(response => {
        if (cancelled) return;
        knownListing.current = response.token ? { key, token: response.token } : null;
        if (response.unchanged || !response.changes) return;
        const result = { changes: response.changes };
        setRepos(prev => {
          if (JSON.stringify(prev) === JSON.stringify(result.changes)) {
            return prev;
          }
          return result.changes;
        });
        if (openReference && openReference.id !== handledReference.current) {
          handledReference.current = openReference.id;
          const resolved = resolveFileReference(openReference.path, result.changes);
          if (resolved.file) {
            setMode('files');
            setReferenceError('');
            setDiff(null);
            scrolledSelectionKey.current = '';
            setRevealKey(k => k + 1);
            setSelection({ ...resolved.file, line: openReference.line });
          } else {
            setReferenceError(resolved.error ?? '');
          }
        } else {
          setSelection(current =>
            current && result.changes.some(repo => repo.repoName === current.repoName && repo.files.some(file => file.file === current.file))
              ? current
              : null
          );
        }
      })
      .catch(e => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [base, mode, revision, active, openReference]);

  // The diff is fetched again only when the selected file itself changed.
  const selectedEntry = selection
    ? repos.find(repo => repo.repoName === selection.repoName)?.files.find(file => file.file === selection.file)
    : undefined;
  const selectedVersion = selectedEntry
    ? [selectedEntry.type, selectedEntry.additions, selectedEntry.deletions, selectedEntry.size, selectedEntry.mtimeMs].join(':')
    : '';

  useEffect(() => {
    if (!active || !selection) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffError('');
    const query = new URLSearchParams({ repo: selection.repoName, file: selection.file });
    void apiFetch<FileDiff>(`${base}/changes/diff?${query}`)
      .then(result => {
        if (cancelled) return;
        perfMark('cs:diff-ready', { panel: 'code', repo: selection.repoName, file: selection.file });
        setDiff(prev => {
          if (
            prev &&
            prev.diff === result.diff &&
            prev.fileContent === result.fileContent &&
            prev.originalContent === result.originalContent
          ) {
            return prev;
          }
          return result;
        });
      })
      .catch(e => {
        if (!cancelled) setDiffError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [base, selection, selectedVersion, active]);

  useEffect(() => {
    if (!selection?.line || !diff || diff.diff || !plainCode.current) return;
    const selectionKey = `${selection.repoName}/${selection.file}:${selection.line}`;
    if (scrolledSelectionKey.current === selectionKey) return;
    scrolledSelectionKey.current = selectionKey;
    const lineHeight = Number.parseFloat(getComputedStyle(plainCode.current).lineHeight) || 16;
    plainCode.current.parentElement?.scrollTo({ top: Math.max(0, (selection.line - 1) * lineHeight - 32) });
  }, [selection, diff]);


  const treeOrderedFiles = useMemo(() => {
    return filteredRepos.flatMap(repo =>
      getTreeOrderedFiles(repo.files || []).map(f => ({
        repoName: repo.repoName,
        repoPath: repo.repoPath,
        file: f.file,
      }))
    );
  }, [filteredRepos]);

  const currentFileIndex = useMemo(() => {
    if (!selection) return -1;
    return treeOrderedFiles.findIndex(
      f => f.repoName === selection.repoName && (f.file === selection.file || normalizePath(f.file) === normalizePath(selection.file))
    );
  }, [treeOrderedFiles, selection]);

  const goToNextFile = useCallback(() => {
    if (treeOrderedFiles.length === 0) return;
    if (currentFileIndex === -1) {
      const next = treeOrderedFiles[0];
      if (next) {
        setReferenceError('');
        setDiff(null);
        scrolledSelectionKey.current = '';
        setRevealKey(k => k + 1);
        setSelection(next);
      }
      return;
    }
    if (currentFileIndex >= 0 && currentFileIndex < treeOrderedFiles.length - 1) {
      const next = treeOrderedFiles[currentFileIndex + 1];
      if (next) {
        setReferenceError('');
        setDiff(null);
        scrolledSelectionKey.current = '';
        setRevealKey(k => k + 1);
        setSelection(next);
      }
    }
  }, [currentFileIndex, treeOrderedFiles]);

  const goToPrevFile = useCallback(() => {
    if (treeOrderedFiles.length === 0) return;
    if (currentFileIndex === -1) {
      const prev = treeOrderedFiles[treeOrderedFiles.length - 1];
      if (prev) {
        setReferenceError('');
        setDiff(null);
        scrolledSelectionKey.current = '';
        setRevealKey(k => k + 1);
        setSelection(prev);
      }
      return;
    }
    if (currentFileIndex > 0) {
      const prev = treeOrderedFiles[currentFileIndex - 1];
      if (prev) {
        setReferenceError('');
        setDiff(null);
        scrolledSelectionKey.current = '';
        setRevealKey(k => k + 1);
        setSelection(prev);
      }
    }
  }, [currentFileIndex, treeOrderedFiles]);

  /**
   * Drag the sidebar edge to trade tree width against diff width. The width is
   * persisted so a user who widens the tree keeps it wide in the floating
   * window, which is often only a few hundred pixels across.
   */
  const setTreeWidthPx = useCallback((value: number) => {
    const width = Math.round(Math.min(TREE_MAX_PX, Math.max(TREE_MIN_PX, value)));
    setTreeWidth(width);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(TREE_WIDTH_KEY, String(width));
      }
    } catch {
      // ignore
    }
  }, []);

  const startTreeDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startWidth = treeWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setDraggingTree(true);

    const onMove = (move: PointerEvent) => {
      setTreeWidthPx(startWidth + (move.clientX - startX));
    };
    const onUp = (up: PointerEvent) => {
      setDraggingTree(false);
      if (target.hasPointerCapture(up.pointerId)) target.releasePointerCapture(up.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }, [treeWidth, setTreeWidthPx]);

  // Alt+Arrow steps through files. Bare j/k stay reserved for hunks in the diff
  // viewer, so the two granularities do not collide under the same keys.
  usePaneHotkey((event) => {
    if (!event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Down' || event.key === 'Up') {
      event.preventDefault();
      if (event.key === 'ArrowDown' || event.key === 'Down') goToNextFile();
      else goToPrevFile();
    }
  }, { respectTerminal: false, enabled: active });

  // / focuses search, Esc clears search
  usePaneHotkey((event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '/') {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else if (event.key === 'Escape') {
      if (searchQuery) {
        event.preventDefault();
        setSearchQuery('');
      }
    }
  }, { respectTerminal: true, enabled: active });

  return (
    <section aria-label="Workspace code" className="flex h-full min-h-0 min-w-0 flex-col bg-background overflow-hidden">
      {/* ─── FULL-WIDTH HEADER ───────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-border p-2 bg-muted/20 shrink-0">
        <span className="mr-1 text-[11px] font-semibold text-foreground shrink-0">ContextSpace code</span>
        <Button size="xs" variant={mode === 'changes' ? 'secondary' : 'ghost'} aria-pressed={mode === 'changes'} onClick={() => setMode('changes')}>Changes</Button>
        <Button size="xs" variant={mode === 'files' ? 'secondary' : 'ghost'} aria-pressed={mode === 'files'} onClick={() => setMode('files')}>Files</Button>
        <Button size="xs" variant="ghost" aria-label="Refresh code" onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw className={cn('size-3', loading && 'animate-spin')} /></Button>
        <Button
          size="xs"
          variant="ghost"
          className="p-1 size-6 shrink-0"
          title={treeCollapsed ? 'Show file tree sidebar' : 'Hide file tree sidebar'}
          aria-label={treeCollapsed ? 'Show file tree sidebar' : 'Hide file tree sidebar'}
          onClick={() => setTreeCollapsed(prev => !prev)}
        >
          {treeCollapsed ? <PanelLeft className="size-3.5 text-muted-foreground" /> : <PanelLeftClose className="size-3.5 text-muted-foreground" />}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="p-1 size-6 shrink-0"
          title="Expand All"
          aria-label="Expand All"
          onClick={expandAllFolders}
        >
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="p-1 size-6 shrink-0"
          title="Collapse All"
          aria-label="Collapse All"
          onClick={collapseAllFolders}
        >
          <ChevronsDownUp className="size-3.5 text-muted-foreground" />
        </Button>
        <span className="ml-auto text-xs text-muted-foreground font-mono shrink-0">
          {loading
            ? 'Refreshing…'
            : searchQuery.trim()
              ? `${matchingFilesCount} / ${totalFilesCount} files`
              : `${totalFilesCount} files`}
        </span>
        {onClose && (
          <Button
            size="xs"
            variant="ghost"
            className="p-1 size-6 shrink-0 ml-1"
            title="Close code panel"
            onClick={onClose}
          >
            <X className="size-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>

      {error && <p role="alert" className="p-2 text-xs text-destructive shrink-0 border-b border-border">{error} <button className="underline" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
      {referenceError && <p role="alert" className="p-2 text-xs text-destructive shrink-0 border-b border-border">{referenceError}</p>}

      {/* ─── MAIN BODY: SIDEBAR ON LEFT, CODE/DIFF ON RIGHT ───────────────── */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-row overflow-hidden">
        {/* Left Sidebar: File Tree */}
        <aside
          className={cn(
            'flex flex-col border-r border-border shrink-0 bg-muted/10 overflow-hidden select-text',
            treeCollapsed ? 'w-0 border-r-0' : 'transition-[width] duration-150'
          )}
          style={treeCollapsed ? undefined : { width: treeWidth }}
        >
          {/* Sticky search input header at the top of the sidebar */}
          <div className="sticky top-0 z-10 p-2 border-b border-border bg-background/95 backdrop-blur-xs flex flex-col gap-1.5 shrink-0">
            <div className="relative flex items-center">
              <Search className="absolute left-2 size-3 text-muted-foreground pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setSearchQuery('');
                    e.currentTarget.blur();
                  }
                }}
                placeholder="Filter files… (/)"
                aria-label="Filter files"
                className="w-full h-7 pl-6 pr-6 rounded border border-border bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary font-sans"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear filter"
                  title="Clear filter (Esc)"
                  className="absolute right-1 p-0.5 rounded text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground px-0.5">
              <span>
                {searchQuery.trim()
                  ? `${matchingFilesCount} / ${totalFilesCount} files`
                  : `${totalFilesCount} files`}
              </span>
              {searchQuery.trim() && matchingFilesCount === 0 && (
                <span className="text-destructive font-medium">0 matches</span>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 [scrollbar-gutter:stable]">
            {filteredRepos.map(repo => {
              const hasMatches = repo.files.length > 0;
              const isCollapsed = searchQuery.trim()
                ? (searchCollapsedRepos[repo.repoName] ?? !hasMatches)
                : !!collapsedRepos[repo.repoName];

              return (
                <details
                  open={!isCollapsed}
                  key={repo.repoName}
                  onToggle={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                    if (searchQuery.trim()) {
                      setSearchCollapsedRepos(prev => ({ ...prev, [repo.repoName]: !isOpen }));
                    } else {
                      setCollapsedRepos(prev => ({ ...prev, [repo.repoName]: !isOpen }));
                    }
                  }}
                >
                  <summary
                    className="flex items-center justify-between cursor-pointer py-1 text-xs font-semibold select-none truncate"
                    onClick={(e) => {
                      e.preventDefault();
                      if (searchQuery.trim()) {
                        setSearchCollapsedRepos(prev => ({
                          ...prev,
                          [repo.repoName]: !(prev[repo.repoName] ?? !hasMatches),
                        }));
                      } else {
                        setCollapsedRepos(prev => ({ ...prev, [repo.repoName]: !prev[repo.repoName] }));
                      }
                    }}
                  >
                    <span className="truncate">{repo.repoName}</span>
                    {searchQuery.trim() && (
                      <span className="ml-1 text-[10px] font-mono text-muted-foreground shrink-0 font-normal">
                        {repo.files.length} match{repo.files.length === 1 ? '' : 'es'}
                      </span>
                    )}
                  </summary>
                  {repo.error ? (
                    <p role="alert" className="text-xs text-destructive">{repo.error}</p>
                  ) : (
                    <FileTree
                      label={`${repo.repoName} ${mode}`}
                      files={repo.files}
                      searchQuery={searchQuery}
                      revealPath={selection?.repoName === repo.repoName ? selection.file : undefined}
                      revealKey={revealKey}
                      selectedPath={selection?.repoName === repo.repoName ? selection.file : undefined}
                      defaultExpanded={mode === 'changes' || !!searchQuery.trim()}
                      expandedPaths={effectiveExpandedPathsByRepo[repo.repoName]}
                      onExpandedPathsChange={(paths) => {
                        if (searchQuery.trim()) {
                          setSearchExpandedPathsByRepo(prev => ({ ...prev, [repo.repoName]: paths }));
                        } else {
                          setExpandedPathsByRepo(prev => ({ ...prev, [repo.repoName]: paths }));
                        }
                      }}
                      renderFile={file => {
                        const glyph = fileTypeGlyph(file.file);
                        const Glyph = glyph.icon;
                        const changed = file.type !== 'unchanged';
                        const isSelected = selection?.repoName === repo.repoName && selection.file === file.file;
                        return (
                          <button
                            className={cn(
                              'group flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent transition-colors cursor-pointer',
                              isSelected && 'bg-accent font-medium text-foreground'
                            )}
                            aria-pressed={isSelected}
                            aria-selected={isSelected}
                            title={`${file.file}${changed ? ` · ${file.type}` : ''}`}
                            onClick={() => {
                              if (isSelected && !selection.line) {
                                return;
                              }
                              setReferenceError('');
                              setDiff(null);
                              scrolledSelectionKey.current = '';
                              setRevealKey(k => k + 1);
                              setSelection({ repoName: repo.repoName, repoPath: repo.repoPath, file: file.file });
                            }}
                          >
                            <Glyph className={cn('size-3.5 shrink-0', glyph.className)} aria-hidden="true" />
                            <span className="truncate">{file.file.split('/').at(-1)}</span>
                            <span className="sr-only">{glyph.label}</span>
                            {changed && (
                              /* A dot and a hue carry the status, so the name keeps
                                 the horizontal space instead of a type label. */
                              <span
                                aria-hidden="true"
                                className={cn(
                                  'ml-auto size-1.5 shrink-0 rounded-full',
                                  file.type === 'added' ? 'bg-emerald-500'
                                    : file.type === 'deleted' ? 'bg-destructive'
                                      : file.type === 'renamed' ? 'bg-sky-400'
                                        : file.type === 'untracked' ? 'bg-emerald-400'
                                          : 'bg-amber-500'
                                )}
                              />
                            )}
                          </button>
                        );
                      }}
                    />
                  )}
                </details>
              );
            })}
            {searchQuery.trim() && matchingFilesCount === 0 && (
              <div className="p-3 text-center text-xs text-muted-foreground space-y-2">
                <p>No matching files for &ldquo;{searchQuery}&rdquo;</p>
                <Button size="xs" variant="outline" onClick={() => setSearchQuery('')}>
                  Clear filter
                </Button>
              </div>
            )}
            {!loading && !error && !searchQuery.trim() && !repos.some(repo => repo.files?.length || repo.error) && (
              <p className="p-2 text-xs text-muted-foreground">
                {mode === 'changes' ? 'No uncommitted changes.' : 'No repository files.'}
              </p>
            )}
          </div>
        </aside>

        {/* Drag handle: widens the tree so long file names stay readable. */}
        {!treeCollapsed && (
          <div
            role="separator"
            aria-label="Resize file tree"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuenow={treeWidth}
            aria-valuemin={TREE_MIN_PX}
            aria-valuemax={TREE_MAX_PX}
            onPointerDown={startTreeDrag}
            onDoubleClick={() => setTreeWidthPx(TREE_DEFAULT_PX)}
            onKeyDown={event => {
              if (event.key === 'ArrowLeft') { event.preventDefault(); setTreeWidthPx(treeWidth - 16); }
              if (event.key === 'ArrowRight') { event.preventDefault(); setTreeWidthPx(treeWidth + 16); }
            }}
            className={cn(
              // No negative margin: the handle must not overlap the tree, or it
              // sits on top of the tree's vertical scrollbar and swallows drags
              // on the scrollbar thumb. The hit area is a dedicated 10px column
              // instead, and arrow keys cover the remaining precision need.
              'group relative z-10 flex w-2.5 shrink-0 touch-none cursor-col-resize select-none items-center justify-center transition-colors',
              draggingTree ? 'bg-primary/60' : 'hover:bg-primary/40 focus-visible:bg-primary/50'
            )}
            title="Drag to resize the file tree; double-click to reset"
          >
            <span className={cn('h-6 w-0.5 rounded transition-colors', draggingTree ? 'bg-primary' : 'bg-muted-foreground/30 group-hover:bg-primary')} />
          </div>
        )}

        {/* Right Main Area: Code & Diff */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-background overflow-hidden select-text">
          {selection ? (
            <div className="flex items-center justify-between border-b border-border bg-muted/10 px-2 py-1 shrink-0">
              <p className="break-all font-mono text-xs font-semibold text-foreground">
                {selection.repoName}/{selection.file}{selection.line ? `:${selection.line}` : ''}
              </p>
              {treeOrderedFiles.length > 1 && (
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={currentFileIndex === 0 || (currentFileIndex === -1 && treeOrderedFiles.length === 0)}
                    onClick={goToPrevFile}
                    aria-keyshortcuts="Alt+ArrowUp"
                    title={mode === 'changes' ? 'Previous changed file (Alt+↑)' : 'Previous file (Alt+↑)'}
                    className="h-5 px-1 text-[10px]"
                  >
                    <ChevronLeft className="size-3" />
                  </Button>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {currentFileIndex >= 0 ? currentFileIndex + 1 : '–'}/{treeOrderedFiles.length}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={currentFileIndex >= treeOrderedFiles.length - 1}
                    onClick={goToNextFile}
                    aria-keyshortcuts="Alt+ArrowDown"
                    title={mode === 'changes' ? 'Next changed file (Alt+↓)' : 'Next file (Alt+↓)'}
                    className="h-5 px-1 text-[10px]"
                  >
                    <ChevronRight className="size-3" />
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="border-b border-border bg-muted/10 p-2 shrink-0">
              <span className="text-xs text-muted-foreground">Select a file</span>
            </div>
          )}

          <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
            {!selection ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground gap-2">
                <FileCode className="size-8 opacity-35" />
                <p className="p-3 text-xs text-muted-foreground">Select a file to inspect its code and changes.</p>
              </div>
            ) : diffError ? (
              <p role="alert" className="p-3 text-xs text-destructive">
                {diffError} <button className="underline" onClick={() => setRevision(value => value + 1)}>Retry</button>
              </p>
            ) : !diff ? (
              <p role="status" className="p-3 text-xs text-muted-foreground">Loading file…</p>
            ) : diff.diff ? (
              <DiffErrorBoundary key={`${workspace}/${selection.repoName}/${selection.file}`}>
                <PluggableDiffViewer
                  filePath={selection.file}
                  repoName={selection.repoName}
                  repoPath={selection.repoPath}
                  patchText={diff.diff}
                  fullFileContent={diff.fileContent}
                  fullOriginalContent={diff.originalContent}
                  initialTargetLine={selection.line}
                  viewMode="unified"
                  fillContainer={true}
                  onNextFile={goToNextFile}
                  onPrevFile={goToPrevFile}
                />
              </DiffErrorBoundary>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="px-3 py-1 border-b border-border/40 bg-muted/10 text-[11px] text-muted-foreground flex items-center justify-between shrink-0">
                  <span>Clean file (no uncommitted diff)</span>
                  {selection.line && <span className="font-mono text-primary font-medium">Line {selection.line}</span>}
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                  <pre ref={plainCode} className="p-3 font-mono text-xs whitespace-pre leading-relaxed select-text">
                    {diff.fileContent || 'Empty file or no text content.'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </section>
  );
}
