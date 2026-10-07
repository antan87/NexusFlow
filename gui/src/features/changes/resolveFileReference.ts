interface RepoFile { file: string }
interface Repo { repoName: string; repoPath: string; files: RepoFile[] }
export interface ResolvedFile { repoName: string; repoPath: string; file: string }

export function resolveFileReference(path: string, repos: Repo[]): { file?: ResolvedFile; error?: string } {
  let cleaned = path.replace(/^<+|>+$/g, '').trim();
  if (/^file:\/\//i.test(cleaned)) {
    try {
      cleaned = decodeURIComponent(new URL(cleaned).pathname).replace(/^\/([a-z]:\/)/i, '$1');
    } catch {
      cleaned = cleaned.replace(/^file:\/\//i, '');
    }
  }
  const normalized = cleaned.replaceAll('\\', '/').replace(/^\.\//, '');
  const absolute = normalized.startsWith('/') || /^[a-z]:\//i.test(normalized);
  const caseInsensitive = /^[a-z]:\//i.test(normalized) || normalized.startsWith('//');
  const matches: ResolvedFile[] = [];
  for (const repo of repos) {
    for (const candidate of repo.files) {
      const file = candidate.file.replaceAll('\\', '/');
      const withRepo = `${repo.repoName}/${file}`;
      const full = `${repo.repoPath.replaceAll('\\', '/').replace(/\/$/, '')}/${file}`;
      const found = absolute
        ? caseInsensitive ? full.toLowerCase() === normalized.toLowerCase() : full === normalized
        : normalized === file || normalized === withRepo || file.endsWith(`/${normalized}`);
      if (found) matches.push({ repoName: repo.repoName, repoPath: repo.repoPath, file: candidate.file });
    }
  }
  if (matches.length === 1) return { file: matches[0] };
  return { error: matches.length ? `“${path}” matches more than one workspace file. Select it from the Files tree.` : `“${path}” is not in this workspace's file tree.` };
}
