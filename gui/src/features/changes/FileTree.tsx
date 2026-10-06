/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

export interface FileTreeProps<T extends TreeFile> {
  files: T[];
  renderFile: (file: T) => ReactNode;
  label: string;
  revealPath?: string;
  revealKey?: number;
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
    return defaultExpanded ? new Set(allPaths) : new Set();
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

  const setExpandedPaths = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      if (isControlled) {
        const next = updater(controlledExpandedPaths);
        onExpandedPathsChange?.(next);
      } else {
        setInternalExpandedPaths(prev => {
          const next = updater(prev);
          onExpandedPathsChange?.(next);
          return next;
        });
      }
    },
    [isControlled, controlledExpandedPaths, onExpandedPathsChange]
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
  useEffect(() => {
    if (!revealPath) return;
    const ancestors = getAncestorPaths(root, revealPath);
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
  }, [revealPath, revealKey, root, setExpandedPaths]);

  // Smoothly scroll the selected/revealed file button into view in the sidebar
  useEffect(() => {
    if (!revealPath) return;
    const normalized = normalizePath(revealPath);
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
  }, [revealPath, revealKey, currentExpandedPaths]);

  const render = (node: TreeNode<T>): ReactNode => (
    <ul className="min-w-0 space-y-0.5">
      {node.directories.map((child) => {
        const isExpanded = currentExpandedPaths.has(child.path);
        return (
          <li key={`dir:${child.path}`}>
            <details
              open={isExpanded}
              data-path={child.path}
              className="min-w-0 group/dir"
              onToggle={(e) => {
                if (e.target !== e.currentTarget) return;
                const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                if (isOpen !== isExpanded) {
                  setExpandedPaths(prev => {
                    const next = new Set(prev);
                    if (isOpen) next.add(child.path);
                    else next.delete(child.path);
                    return next;
                  });
                  onTogglePath?.(child.path, isOpen);
                }
              }}
            >
              {/* A native disclosure triangle plus a closed/open folder pair reads as
                  a tree far faster than a single static folder glyph. */}
              <summary
                className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-primary select-none"
                onClick={(e) => {
                  e.preventDefault();
                  togglePath(child.path);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    togglePath(child.path);
                  }
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
                <div className="ml-2 border-l border-border pl-1.5">{render(child)}</div>
              )}
            </details>
          </li>
        );
      })}
      {node.files.map((file) => (
        <li key={`file:${file.file}`} data-file-path={normalizePath(file.file)}>
          {renderFile(file)}
        </li>
      ))}
    </ul>
  );

  return (
    <nav ref={host} aria-label={label}>
      {render(root)}
    </nav>
  );
}
