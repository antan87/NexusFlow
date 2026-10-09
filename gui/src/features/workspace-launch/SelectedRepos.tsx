import { FolderGit2, X } from 'lucide-react';
import type { RepoInfo } from '../../types.js';

/**
 * The repositories picked so far, as chips that stay in view however long the
 * checklist is. Each can be removed without finding it in the list again.
 */
export function SelectedRepos({ repos, onRemove }: { repos: RepoInfo[]; onRemove: (repo: RepoInfo) => void }) {
  if (repos.length === 0) return null;
  return (
    <ul aria-label="Selected repositories" className="mt-2 flex flex-wrap gap-1.5">
      {repos.map((repo) => (
        <li
          key={repo.path}
          title={repo.path}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 py-1 pr-1 pl-2.5 text-xs font-medium"
        >
          <FolderGit2 aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">{repo.name}</span>
          <button
            type="button"
            aria-label={`Remove ${repo.name}`}
            onClick={() => onRemove(repo)}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
