import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Folder } from 'lucide-react';

export interface TreeFile { file: string }
interface Directory<T> { directories: Map<string, Directory<T>>; files: T[] }

/** Keep the original Git path intact: the hierarchy is only a presentation. */
export function FileTree<T extends TreeFile>({ files, renderFile, label, revealPath, revealKey }: {
  files: T[]; renderFile: (file: T) => ReactNode; label: string; revealPath?: string; revealKey?: number;
}) {
  const host = useRef<HTMLElement>(null);
  const root = useMemo(() => {
    const root: Directory<T> = { directories: new Map(), files: [] };
    for (const file of files) {
      const parts = file.file.split('/');
      let node = root;
      for (const part of parts.slice(0, -1)) {
        if (!node.directories.has(part)) node.directories.set(part, { directories: new Map(), files: [] });
        node = node.directories.get(part)!;
      }
      node.files.push(file);
    }
    return root;
  }, [files]);
  useEffect(() => {
    if (!revealPath) return;
    for (const details of host.current?.querySelectorAll<HTMLDetailsElement>('details[data-path]') ?? []) {
      if (revealPath.startsWith(`${details.dataset.path}/`)) details.open = true;
    }
  }, [revealPath, revealKey]);
  const render = (node: Directory<T>, prefix = ''): ReactNode => <ul className="min-w-0 space-y-0.5">
    {[...node.directories].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => <li key={`dir:${name}`}>
      <details open data-path={prefix ? `${prefix}/${name}` : name} className="min-w-0">
        <summary className="cursor-pointer rounded px-2 py-1 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-primary"><Folder className="mr-1 inline size-3.5" aria-hidden="true" />{name}</summary>
        <div className="ml-3 border-l border-border pl-2">{render(child, prefix ? `${prefix}/${name}` : name)}</div>
      </details>
    </li>)}
    {[...node.files].sort((a, b) => a.file.localeCompare(b.file)).map(file => <li key={`file:${file.file}`}>{renderFile(file)}</li>)}
  </ul>;
  return <nav ref={host} aria-label={label}>{render(root)}</nav>;
}
