import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { RepoInfo } from '../types.js';
import { Input } from './ui/input.js';
import { Button } from './ui/button.js';
import { Popover, PopoverTrigger, PopoverPopup } from './ui/popover.js';

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
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        if (isOpen) setQuery('');
        setOpen(isOpen);
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" disabled={disabled} className="h-8 text-xs text-muted-foreground">
            <Plus size={14} /> Add repository
          </Button>
        }
      />

      <PopoverPopup align="end" className="w-[320px]" viewportClassName="p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search repositories"
              className="pl-8"
              aria-label="Search repositories"
            />
          </div>
        </div>
        <div role="listbox" className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">No repositories found.</div>
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
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{r.path}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.defaultBranch}</span>
              </button>
            ))
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
