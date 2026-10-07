/* eslint-disable react-refresh/only-export-components */
import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Folder, FolderOpen } from 'lucide-react';

export interface TreeFile {
  file: string;
}

export interface TreeNode<T extends TreeFile = TreeFile> {
  name: string;
  path: string;
  directories: TreeNode<T>[];
  files: T[];
}

interface MutableTreeNode<T> {
  name: string;
  path: string;
  directories: Map<string, MutableTreeNode<T>>;
  files: T[];
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^(\.\/|\/)+/, '');
}

function toTreeNode<T extends TreeFile>(mutable: MutableTreeNode<T>): TreeNode<T> {
  const sortedDirKeys = [...mutable.directories.keys()].sort((a, b) => a.localeCompare(b));
  const directories = sortedDirKeys.map(key => toTreeNode(mutable.directories.get(key)!));
  const files = [...mutable.files].sort((a, b) =>
    normalizePath(a.file).localeCompare(normalizePath(b.file))
  );
  return {
    name: mutable.name,
    path: mutable.path,
    directories,
    files,
  };
}

function compactTreeNode<T extends TreeFile>(
  node: TreeNode<T>,
  isRoot: boolean,
  compact: boolean
): TreeNode<T> {
  node.directories = node.directories.map(child => compactTreeNode(child, false, compact));

  if (!compact || isRoot) {
    return node;
  }

  if (node.files.length === 0 && node.directories.length === 1) {
    const child = node.directories[0]!;
    return {
      name: `${node.name}/${child.name}`,
      path: child.path,
      directories: child.directories,
      files: child.files,
    };
  }

  return node;
}

/**
 * Builds a deterministic visual tree from a list of files.
 * Single-child directory chains are compacted into combined paths (e.g. "src/features")
 * unless options.compact is false.
 */
export function buildCompactedTree<T extends TreeFile>(
  files: readonly T[],
  options: { compact?: boolean } = { compact: true }
): TreeNode<T> {
  const root: MutableTreeNode<T> = {
    name: '',
    path: '',
    directories: new Map(),
    files: [],
  };

  for (const file of files) {
    if (!file || typeof file.file !== 'string') continue;
    const normalized = normalizePath(file.file);
    const parts = normalized.split('/').filter(part => part && part !== '.');

    if (parts.length <= 1) {
      root.files.push(file);
      continue;
    }

    let current = root;
    let currentPath = '';
    for (const segment of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let next = current.directories.get(segment);
      if (!next) {
        next = { name: segment, path: currentPath, directories: new Map(), files: [] };
        current.directories.set(segment, next);
      }
      current = next;
    }
    current.files.push(file);
  }

  const uncompacted = toTreeNode(root);
  return compactTreeNode(uncompacted, true, options.compact ?? true);
}

/**
 * Flattens a tree into files in the exact visual depth-first order they appear on screen:
 * subdirectories first (alphabetical by name), then directory files (alphabetical by path).
 */
export function flattenTreeFiles<T extends TreeFile>(root: TreeNode<T>): T[] {
  const result: T[] = [];
  const walk = (node: TreeNode<T>) => {
    for (const dir of node.directories) {
      walk(dir);
    }
    for (const file of node.files) {
      result.push(file);
    }
  };
  walk(root);
  return result;
}

/**
 * Returns files in deterministic visual tree order.
 */
export function treeOrderedFiles<T extends TreeFile>(
  files: readonly T[],
  options?: { compact?: boolean }
): T[] {
  return flattenTreeFiles(buildCompactedTree(files, options));
}

/**
 * Collects all directory paths present in the tree.
 */
export function getAllDirectoryPaths<T extends TreeFile>(root: TreeNode<T>): string[] {
  const result: string[] = [];
  const walk = (node: TreeNode<T>) => {
    for (const dir of node.directories) {
      result.push(dir.path);
      walk(dir);
    }
  };
  walk(root);
  return result;
}

/**
 * Returns all ancestor directory paths for a target file or path within the given tree.
 */
export function getAncestorPaths<T extends TreeFile>(
  root: TreeNode<T>,
  targetPath: string
): string[] {
  if (!targetPath) return [];
  const normalized = normalizePath(targetPath);
  const ancestors = new Set<string>();

  const walk = (node: TreeNode<T>): boolean => {
    let containsTarget = false;

    // Check if target directly matches this directory
    if (node.path && (normalized === node.path || normalized.startsWith(`${node.path}/`))) {
      ancestors.add(node.path);
      containsTarget = true;
    }

    // Check files in this directory
    for (const file of node.files) {
      if (!file?.file) continue;
      const fNorm = normalizePath(file.file);
      if (fNorm === normalized || fNorm.startsWith(`${normalized}/`)) {
        containsTarget = true;
      }
    }

    // Check subdirectories
    for (const dir of node.directories) {
      if (walk(dir)) {
        containsTarget = true;
      }
    }

    if (containsTarget && node.path) {
      ancestors.add(node.path);
    }
    return containsTarget;
  };

  walk(root);
  return Array.from(ancestors);
}

/**
 * Case-insensitively filters a list of files by matching the search query
 * against their file path.
 * If query is empty or whitespace-only, returns all files.
 */
export function filterTreeFiles<T extends TreeFile>(
  files: readonly T[],
  query: string
): T[] {
  if (!query || !query.trim()) {
    return [...files];
  }
  const q = query.trim().toLowerCase();
  const normalizedQ = normalizePath(q);
  return files.filter(f => {
    if (!f || typeof f.file !== 'string') return false;
    const raw = f.file.toLowerCase();
    const normalized = normalizePath(f.file).toLowerCase();
    return raw.includes(q) || normalized.includes(q) || (normalizedQ ? normalized.includes(normalizedQ) : false);
  });
}

/**
 * Returns all directory paths containing matching files for a given search query,
 * based on the compacted visual tree hierarchy.
 */
export function getMatchingBranchPaths<T extends TreeFile>(
  files: readonly T[],
  query: string,
  options?: { compact?: boolean }
): Set<string> {
  if (!query || !query.trim()) {
    return new Set();
  }
  const matching = filterTreeFiles(files, query);
  if (matching.length === 0) {
    return new Set();
  }
  const tree = buildCompactedTree(matching, options);
  return new Set(getAllDirectoryPaths(tree));
}

export interface VisibleTreeRow {
  type: 'folder' | 'file';
  id: string;
  path: string;
  name: string;
  parentPath: string | null;
  isExpanded?: boolean;
}

/**
 * Returns all currently visible rows (folders and files) in visual tree order,
 * respecting the current folder expansion set.
 */
export function getVisibleTreeRows<T extends TreeFile>(
  root: TreeNode<T>,
  expandedPaths: Set<string>
): VisibleTreeRow[] {
  const result: VisibleTreeRow[] = [];

  const walk = (node: TreeNode<T>, parentPath: string | null) => {
    for (const dir of node.directories) {
      const isExpanded = expandedPaths.has(dir.path);
      result.push({
        type: 'folder',
        id: `dir:${dir.path}`,
        path: dir.path,
        name: dir.name,
        parentPath,
        isExpanded,
      });
      if (isExpanded) {
        walk(dir, dir.path);
      }
    }
    for (const file of node.files) {
      const norm = normalizePath(file.file);
      const fileName = norm.split('/').filter(Boolean).at(-1) ?? norm;
      result.push({
        type: 'file',
        id: `file:${norm}`,
        path: norm,
        name: fileName,
        parentPath,
      });
    }
  };

  walk(root, null);
  return result;
}

export type TreeNavAction =
  | { type: 'focus'; targetRow: VisibleTreeRow }
  | { type: 'toggle'; path: string }
  | { type: 'activate'; path: string }
  | { type: 'none' };

/**
 * Computes the next navigation action (focus, toggle, activate, or none) for a keyboard event
 * within a WAI-ARIA Treeview based on current active row and visible rows.
 */
export function computeTreeKeyNavigation(
  key: string,
  currentRow: VisibleTreeRow | undefined,
  visibleRows: readonly VisibleTreeRow[]
): TreeNavAction {
  if (!currentRow || visibleRows.length === 0) {
    return { type: 'none' };
  }

  const currentIndex = visibleRows.findIndex(r => r.id === currentRow.id);
  if (currentIndex === -1) {
    return { type: 'none' };
  }

  switch (key) {
    case 'ArrowDown': {
      if (currentIndex < visibleRows.length - 1) {
        return { type: 'focus', targetRow: visibleRows[currentIndex + 1]! };
      }
      return { type: 'none' };
    }
    case 'ArrowUp': {
      if (currentIndex > 0) {
        return { type: 'focus', targetRow: visibleRows[currentIndex - 1]! };
      }
      return { type: 'none' };
    }
    case 'ArrowRight': {
      if (currentRow.type === 'folder') {
        if (!currentRow.isExpanded) {
          return { type: 'toggle', path: currentRow.path };
        }
        const nextRow = visibleRows[currentIndex + 1];
        if (nextRow && nextRow.parentPath === currentRow.path) {
          return { type: 'focus', targetRow: nextRow };
        }
      }
      return { type: 'none' };
    }
    case 'ArrowLeft': {
      if (currentRow.type === 'folder' && currentRow.isExpanded) {
        return { type: 'toggle', path: currentRow.path };
      }
      if (currentRow.parentPath) {
        const parentRow = visibleRows.find(r => r.type === 'folder' && r.path === currentRow.parentPath);
        if (parentRow) {
          return { type: 'focus', targetRow: parentRow };
        }
      }
      return { type: 'none' };
    }
    case 'Home': {
      return { type: 'focus', targetRow: visibleRows[0]! };
    }
    case 'End': {
      return { type: 'focus', targetRow: visibleRows[visibleRows.length - 1]! };
    }
    case 'Enter':
    case ' ': {
      if (currentRow.type === 'folder') {
        return { type: 'toggle', path: currentRow.path };
      }
      return { type: 'activate', path: currentRow.path };
    }
    default:
      return { type: 'none' };
  }
}

function findFolderSummary(container: HTMLElement | null, path: string): HTMLElement | null {
  if (!container) return null;
  const summaries = container.querySelectorAll<HTMLElement>('summary[data-path]');
  for (const s of summaries) {
    if (s.dataset.path === path) return s;
  }
  return null;
}

function findFileTarget(container: HTMLElement | null, normalizedPath: string): HTMLElement | null {
  if (!container) return null;
  const items = container.querySelectorAll<HTMLElement>('[data-file-path]');
  for (const item of items) {
    if (item.dataset.filePath === normalizedPath) {
      return item.querySelector<HTMLElement>('button, [data-tree-row="file"], [role="button"]') ?? item;
    }
  }
  return null;
}

export interface FileTreeProps<T extends TreeFile> {
  files: T[];
  renderFile: (file: T, meta?: { isSelected: boolean; tabIndex: number }) => ReactNode;
  label: string;
  revealPath?: string;
  revealKey?: number;
  selectedPath?: string;
  compact?: boolean;
  defaultExpanded?: boolean;
  expandedPaths?: Set<string>;
  onExpandedPathsChange?: (paths: Set<string>) => void;
  onTogglePath?: (path: string, isOpen: boolean) => void;
  searchQuery?: string;
}

/** Keep the original Git path intact: the hierarchy is only a presentation. */
export function FileTree<T extends TreeFile>({
  files,
  renderFile,
  label,
  revealPath,
  revealKey,
  selectedPath,
  compact = true,
  defaultExpanded = true,
  expandedPaths: controlledExpandedPaths,
  onExpandedPathsChange,
  onTogglePath,
  searchQuery,
}: FileTreeProps<T>) {
  const host = useRef<HTMLElement>(null);
  const effectiveFiles = useMemo(() => {
    return searchQuery && searchQuery.trim() ? filterTreeFiles(files, searchQuery) : files;
  }, [files, searchQuery]);
  const root = useMemo(() => buildCompactedTree(effectiveFiles, { compact }), [effectiveFiles, compact]);
  const allPaths = useMemo(() => getAllDirectoryPaths(root), [root]);

  // Uncontrolled state when expandedPaths prop is not provided
  const [internalExpandedPaths, setInternalExpandedPaths] = useState<Set<string>>(() => {
    if (searchQuery && searchQuery.trim()) return new Set(allPaths);
    const initial = defaultExpanded ? new Set(allPaths) : new Set<string>();
    const initialTarget = revealPath ?? selectedPath;
    if (initialTarget) {
      for (const a of getAncestorPaths(root, initialTarget)) {
        initial.add(a);
      }
    }
    return initial;
  });

  // Auto-expand all matching branches when search query is entered in uncontrolled mode
  useEffect(() => {
    if (!searchQuery || !searchQuery.trim() || controlledExpandedPaths !== undefined) return;
    setInternalExpandedPaths(new Set(allPaths));
  }, [searchQuery, allPaths, controlledExpandedPaths]);

  // Track changes to allPaths when in defaultExpanded uncontrolled mode
  const prevPathsRef = useRef(allPaths.join('|'));
  useEffect(() => {
    const key = allPaths.join('|');
    if (key !== prevPathsRef.current) {
      const prevKey = prevPathsRef.current;
      prevPathsRef.current = key;
      if (defaultExpanded && controlledExpandedPaths === undefined) {
        const oldPaths = new Set(prevKey.split('|').filter(Boolean));
        setInternalExpandedPaths(prev => {
          const next = new Set(prev);
          for (const p of allPaths) {
            // Only add brand-new directories; do not re-expand folders the user manually collapsed
            if (!oldPaths.has(p)) {
              next.add(p);
            }
          }
          // Remove directories that no longer exist in the tree
          const allSet = new Set(allPaths);
          for (const p of next) {
            if (!allSet.has(p)) {
              next.delete(p);
            }
          }
          return next;
        });
      }
    }
  }, [allPaths, defaultExpanded, controlledExpandedPaths]);

  const isControlled = controlledExpandedPaths !== undefined;
  const currentExpandedPaths = isControlled ? controlledExpandedPaths : internalExpandedPaths;

  const onExpandedPathsChangeRef = useRef(onExpandedPathsChange);
  const controlledPathsRef = useRef(controlledExpandedPaths);

  useEffect(() => {
    onExpandedPathsChangeRef.current = onExpandedPathsChange;
    controlledPathsRef.current = controlledExpandedPaths;
  });

  const setExpandedPaths = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      if (controlledPathsRef.current !== undefined) {
        const current = controlledPathsRef.current;
        const next = updater(current);
        if (next !== current && (next.size !== current.size || [...next].some(p => !current.has(p)))) {
          onExpandedPathsChangeRef.current?.(next);
        }
      } else {
        setInternalExpandedPaths(prev => {
          const next = updater(prev);
          if (next !== prev && (next.size !== prev.size || [...next].some(p => !prev.has(p)))) {
            onExpandedPathsChangeRef.current?.(next);
          }
          return next;
        });
      }
    },
    []
  );

  const togglePath = useCallback(
    (path: string) => {
      const currentlyOpen = currentExpandedPaths.has(path);
      const nextOpen = !currentlyOpen;
      setExpandedPaths(prev => {
        const next = new Set(prev);
        if (nextOpen) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      });
      onTogglePath?.(path, nextOpen);
    },
    [currentExpandedPaths, setExpandedPaths, onTogglePath]
  );

  // Auto-expand parent/ancestor folders when a file is revealed or selected
  const targetPath = revealPath ?? selectedPath;

  useEffect(() => {
    if (!targetPath) return;
    const ancestors = getAncestorPaths(root, targetPath);
    if (ancestors.length > 0) {
      setExpandedPaths(prev => {
        let changed = false;
        const next = new Set(prev);
        for (const p of ancestors) {
          if (!next.has(p)) {
            next.add(p);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [targetPath, revealKey, root, setExpandedPaths]);

  // Smoothly scroll the selected/revealed file button into view in the sidebar
  useEffect(() => {
    if (!targetPath) return;
    const normalized = normalizePath(targetPath);
    const items = host.current?.querySelectorAll<HTMLElement>('[data-file-path]');
    for (const item of items ?? []) {
      if (item.dataset.filePath === normalized) {
        const target = item.querySelector<HTMLElement>('button, [role="button"]') ?? item;
        if (typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (typeof item.scrollIntoView === 'function') {
          item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        break;
      }
    }
  }, [targetPath, revealKey, currentExpandedPaths]);

  // Track focused row for roving tabindex
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);

  useEffect(() => {
    if (!targetPath) return;
    const norm = normalizePath(targetPath);
    const isDir = allPaths.includes(norm);
    setFocusedRowId(isDir ? `dir:${norm}` : `file:${norm}`);
  }, [targetPath, revealKey, allPaths]);

  const visibleRows = useMemo(
    () => getVisibleTreeRows(root, currentExpandedPaths),
    [root, currentExpandedPaths]
  );

  const visibleRowIds = useMemo(() => new Set(visibleRows.map(r => r.id)), [visibleRows]);
  const effectiveSelectedPath = selectedPath ?? revealPath;

  const activeRowId = useMemo(() => {
    if (focusedRowId && visibleRowIds.has(focusedRowId)) {
      return focusedRowId;
    }
    if (effectiveSelectedPath) {
      const selId = `file:${normalizePath(effectiveSelectedPath)}`;
      if (visibleRowIds.has(selId)) {
        return selId;
      }
    }
    return visibleRows[0]?.id ?? null;
  }, [focusedRowId, visibleRowIds, effectiveSelectedPath, visibleRows]);

  const focusRow = useCallback(
    (row: VisibleTreeRow) => {
      setFocusedRowId(row.id);
      if (row.type === 'folder') {
        const summaryEl = findFolderSummary(host.current, row.path);
        summaryEl?.focus();
      } else {
        const fileTarget = findFileTarget(host.current, row.path);
        fileTarget?.focus();
      }
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      const key = e.key;
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(key)) {
        return;
      }

      let currentIndex = visibleRows.findIndex(r => r.id === activeRowId);
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl) {
        const summary = activeEl.closest('summary[data-path]');
        if (summary) {
          const p = summary.getAttribute('data-path');
          const idx = visibleRows.findIndex(r => r.id === `dir:${p}`);
          if (idx !== -1) currentIndex = idx;
        } else {
          const fileLi = activeEl.closest('[data-file-path]');
          if (fileLi) {
            const p = fileLi.getAttribute('data-file-path');
            const idx = visibleRows.findIndex(r => r.id === `file:${p}`);
            if (idx !== -1) currentIndex = idx;
          }
        }
      }

      if (currentIndex === -1 && visibleRows.length > 0) {
        currentIndex = 0;
      }
      const currentRow = visibleRows[currentIndex];
      if (!currentRow) return;

      const action = computeTreeKeyNavigation(key, currentRow, visibleRows);
      if (action.type !== 'none') {
        e.preventDefault();
      }

      if (action.type === 'focus') {
        focusRow(action.targetRow);
      } else if (action.type === 'toggle') {
        setFocusedRowId(currentRow.id);
        togglePath(action.path);
      } else if (action.type === 'activate') {
        setFocusedRowId(currentRow.id);
        const fileTarget = findFileTarget(host.current, action.path);
        if (fileTarget && e.target !== fileTarget && !fileTarget.contains(e.target as Node)) {
          fileTarget.click();
        }
      }
    },
    [visibleRows, activeRowId, focusRow, togglePath]
  );

  const renderFileRow = (
    file: T,
    meta: { isSelected: boolean; tabIndex: number }
  ) => {
    const rendered = renderFile(file, meta);
    const normalizedFilePath = normalizePath(file.file);
    if (isValidElement(rendered)) {
      const props = rendered.props as Record<string, any>;
      return cloneElement(rendered as React.ReactElement<any>, {
        tabIndex: meta.tabIndex,
        'data-file-path': normalizedFilePath,
        'data-tree-row': 'file',
        ...(props['aria-selected'] === undefined
          ? { 'aria-selected': meta.isSelected }
          : {}),
        onFocus: (e: React.FocusEvent) => {
          props.onFocus?.(e);
          setFocusedRowId(`file:${normalizedFilePath}`);
        },
      });
    }
    return rendered;
  };

  const renderTree = (node: TreeNode<T>, isRoot: boolean): ReactNode => {
    const content = (
      <>
        {node.directories.map((child) => {
          const isExpanded = currentExpandedPaths.has(child.path);
          const isRowActive = activeRowId === `dir:${child.path}`;
          const folderTabIndex = isRowActive ? 0 : -1;

          return (
            <li
              key={`dir:${child.path}`}
              role="treeitem"
              aria-expanded={isExpanded}
              tabIndex={folderTabIndex}
              className="tree-row-wrapper min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_28px]"
              style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 28px' }}
              onFocus={(e) => {
                if (e.target === e.currentTarget) {
                  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
                    return;
                  }
                  const summary = findFolderSummary(e.currentTarget, child.path);
                  summary?.focus();
                }
              }}
            >
              <details
                open={isExpanded}
                data-path={child.path}
                className="min-w-0 group/dir"
              >
                {/* A native disclosure triangle plus a closed/open folder pair reads as
                    a tree far faster than a single static folder glyph. */}
                <summary
                  data-tree-row="folder"
                  data-path={child.path}
                  tabIndex={folderTabIndex}
                  aria-expanded={isExpanded}
                  className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-primary select-none"
                  onClick={(e) => {
                    e.preventDefault();
                    togglePath(child.path);
                    setFocusedRowId(`dir:${child.path}`);
                  }}
                  onFocus={() => {
                    setFocusedRowId(`dir:${child.path}`);
                  }}
                >
                  <ChevronRight
                    className="size-3 shrink-0 text-muted-foreground transition-transform group-open/dir:rotate-90"
                    aria-hidden="true"
                  />
                  <Folder
                    className="size-3.5 shrink-0 text-warning-foreground/80 group-open/dir:hidden"
                    aria-hidden="true"
                  />
                  <FolderOpen
                    className="hidden size-3.5 shrink-0 text-warning-foreground group-open/dir:block"
                    aria-hidden="true"
                  />
                  <span className="truncate">{child.name}</span>
                </summary>
                {isExpanded && (
                  <div className="ml-2 border-l border-border pl-1.5">
                    {renderTree(child, false)}
                  </div>
                )}
              </details>
            </li>
          );
        })}
        {node.files.map((file) => {
          const normalizedFilePath = normalizePath(file.file);
          const isSelected = effectiveSelectedPath !== undefined && normalizedFilePath === normalizePath(effectiveSelectedPath);
          const isRowActive = activeRowId === `file:${normalizedFilePath}`;
          const fileTabIndex = isRowActive ? 0 : -1;

          return (
            <li
              key={`file:${file.file}`}
              role="treeitem"
              aria-selected={isSelected}
              tabIndex={fileTabIndex}
              data-file-path={normalizedFilePath}
              className="tree-row-wrapper min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_28px]"
              style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 28px' }}
              onFocus={(e) => {
                if (e.target === e.currentTarget) {
                  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
                    return;
                  }
                  const target = findFileTarget(e.currentTarget, normalizedFilePath);
                  if (target && target !== e.currentTarget) {
                    target.focus();
                  }
                }
              }}
            >
              {renderFileRow(file, { isSelected, tabIndex: fileTabIndex })}
            </li>
          );
        })}
      </>
    );

    if (isRoot) {
      return (
        <ul
          role="tree"
          aria-label={label}
          className="min-w-0 space-y-0.5 outline-none"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          {content}
        </ul>
      );
    }

    return (
      <ul role="group" className="min-w-0 space-y-0.5">
        {content}
      </ul>
    );
  };

  return (
    <nav ref={host} aria-label={label}>
      {renderTree(root, true)}
    </nav>
  );
}

