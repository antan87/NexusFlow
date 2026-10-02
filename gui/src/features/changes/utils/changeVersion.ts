/**
 * Change versions: a cheap fingerprint of one changed file, so a cached diff can
 * be dropped once the file moves on. These are the same fields the workspace
 * code panel compares to decide when to refetch.
 */
export interface VersionedFile {
  file: string;
  type?: string;
  additions?: number;
  deletions?: number;
  size?: number;
  mtimeMs?: number;
}

export interface VersionedRepo {
  repoName: string;
  files?: VersionedFile[];
  /** Set when the repository could not be listed; its file list is then empty, not authoritative. */
  error?: string;
}

/** What a viewer fetched for one file, and the version it was fetched at. */
export interface FetchedFile {
  repoName: string;
  file: string;
  version: string;
}

export function cacheKeyFor(repoName: string, file: string): string {
  return `${repoName}/${file}`;
}

export function changeVersion(file: Omit<VersionedFile, 'file'>): string {
  return [file.type, file.additions, file.deletions, file.size, file.mtimeMs].join(':');
}

export interface CacheDelta {
  /** Still changed, but no longer at the version that was fetched. */
  stale: string[];
  /** No longer in the change list at all (committed, reverted or deleted). */
  removed: string[];
}

export function diffCacheDelta(
  fetched: Readonly<Record<string, FetchedFile>>,
  repos: readonly VersionedRepo[],
): CacheDelta {
  const current = new Map<string, string>();
  const unlistable = new Set<string>();
  for (const repo of repos) {
    if (repo.error) unlistable.add(repo.repoName);
    for (const file of repo.files ?? []) {
      current.set(cacheKeyFor(repo.repoName, file.file), changeVersion(file));
    }
  }

  const stale: string[] = [];
  const removed: string[] = [];
  for (const [key, entry] of Object.entries(fetched)) {
    // A repository that failed to list (a git lock, say) reports no files. That
    // says nothing about its files, so keep what we hold until it lists again.
    if (unlistable.has(entry.repoName)) continue;
    const version = current.get(key);
    if (version === undefined) removed.push(key);
    else if (version !== entry.version) stale.push(key);
  }
  return { stale, removed };
}
