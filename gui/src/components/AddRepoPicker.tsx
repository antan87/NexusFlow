import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { RepoInfo } from '../types.js';
import { Input } from './ui/input.js';

/** A searchable popover for attaching another repository to a workspace. */
export function AddRepoPicker({
  repos,
  disabled,
  onAdd,
}: {
  repos: RepoInfo[];
  disabled?: boolean;
  onAdd: (repoPath: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
  }, [repos, query]);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setQuery('');
          setOpen((o) => !o);
        }}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={14} /> Add repository
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1.5 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-sm animate-fade-in">
            <div className="relative border-b border-border p-2">
              <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search repositories"
                className="[&_[data-slot=input]]:pl-8"
              />
            </div>
            <div role="listbox" className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">No repositories found.</div>
              ) : (
                filtered.map((r) => (
                  <button
                    key={r.path}
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setOpen(false);
                      onAdd(r.path);
                    }}
                    className="flex w-full cursor-pointer flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <span className="font-mono text-xs font-semibold text-foreground">{r.name}</span>
                    <span className="w-full truncate text-[10px] text-muted-foreground">{r.path}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
