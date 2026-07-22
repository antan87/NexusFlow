import { useState } from 'react';
import { FolderPlus } from 'lucide-react';

import { Button } from './ui/button.js';
import { Input } from './ui/input.js';
import { Spinner } from './ui/spinner.js';
import { useCreateRepo } from '../lib/api/queries.js';
import type { RepoInfo } from '../types.js';

/**
 * Inline "scaffold a brand-new repo" affordance for repo pickers: expands to a
 * name input, creates the repo in the dev directory, and hands it back so the
 * caller can add it to the current selection.
 */
export function ScaffoldRepoInline({ onCreated }: { onCreated: (repo: RepoInfo) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createRepo = useCreateRepo();

  const submit = async () => {
    setError(null);
    try {
      const { repo } = await createRepo.mutateAsync(name.trim());
      setName('');
      setOpen(false);
      onCreated(repo);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <FolderPlus className="size-3.5" /> Scaffold a brand-new repository
      </button>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()}
          placeholder="new-repo-name"
          className="h-7 font-mono text-xs"
          aria-label="New repository name"
          autoFocus
        />
        <Button size="xs" onClick={submit} disabled={!name.trim() || createRepo.isPending}>
          {createRepo.isPending ? <Spinner /> : null}
          Create
        </Button>
        <Button size="xs" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive-foreground">{error}</p>}
    </div>
  );
}
