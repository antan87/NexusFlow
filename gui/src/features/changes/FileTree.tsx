/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
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

/** Keep the original Git path intact: the hierarchy is only a presentation. */
export function FileTree<T extends TreeFile>({ files, renderFile, label, revealPath, revealKey, compact = true }: {
  files: T[]; renderFile: (file: T) => ReactNode; label: string; revealPath?: string; revealKey?: number; compact?: boolean;
}) {
  const host = useRef<HTMLElement>(null);
  const root = useMemo(() => buildCompactedTree(files, { compact }), [files, compact]);

  useEffect(() => {
    if (!revealPath) return;
    const normalized = normalizePath(revealPath);
    for (const details of host.current?.querySelectorAll<HTMLDetailsElement>('details[data-path]') ?? []) {
      const p = details.dataset.path;
      if (p && (normalized === p || normalized.startsWith(`${p}/`))) {
        details.open = true;
      }
    }
  }, [revealPath, revealKey]);

  const render = (node: TreeNode<T>): ReactNode => (
    <ul className="min-w-0 space-y-0.5">
      {node.directories.map((child) => (
        <li key={`dir:${child.path}`}>
          <details open data-path={child.path} className="min-w-0 group/dir">
            {/* A native disclosure triangle plus a closed/open folder pair reads as
                a tree far faster than a single static folder glyph. */}
            <summary className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-primary">
              <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open/dir:rotate-90" aria-hidden="true" />
              <Folder className="size-3.5 shrink-0 text-warning-foreground/80 group-open/dir:hidden" aria-hidden="true" />
              <FolderOpen className="hidden size-3.5 shrink-0 text-warning-foreground group-open/dir:block" aria-hidden="true" />
              <span className="truncate">{child.name}</span>
            </summary>
            <div className="ml-3 border-l border-border pl-2">{render(child)}</div>
          </details>
        </li>
      ))}
      {node.files.map((file) => (
        <li key={`file:${file.file}`}>{renderFile(file)}</li>
      ))}
    </ul>
  );

  return <nav ref={host} aria-label={label}>{render(root)}</nav>;
}
