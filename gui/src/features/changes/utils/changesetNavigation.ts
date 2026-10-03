/**
 * Resolving a cross-file jump (Monaco go-to-definition, the symbol navigator)
 * to one of the files in the changeset.
 */
export interface NavigableFile {
  repoName: string;
  repoPath?: string;
  file: string;
}

const WILDCARD_REPO = 'workspace';

function toSlashes(value: string): string {
  return value.replaceAll('\\', '/');
}

/** True for `/abs`, `C:/abs` and `//server/share` references. */
export function isAbsoluteReference(value: string): boolean {
  return /^([a-z]:)?[\\/]/i.test(value);
}

function relativePath(value: string): string {
  return toSlashes(value).replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

function joinRepoFile(repoPath: string, file: string): string {
  return `${toSlashes(repoPath).replace(/\/+$/, '')}/${relativePath(file)}`;
}

/**
 * The changeset file a jump targets, or -1 when it is not in the changeset or
 * is ambiguous. Matching is exact on whole paths: a target never matches a
 * file merely because their names end the same way (`xa.ts` is not `a.ts`, and
 * `index.ts` at a repository root is not `src/index.ts`).
 */
export function findChangedFileIndex(
  files: readonly NavigableFile[],
  targetRepo: string | undefined,
  targetFile: string,
): number {
  const anyRepo = !targetRepo || targetRepo === WILDCARD_REPO;
  const byRelativePath = (): number[] => {
    const wanted = relativePath(targetFile);
    return files.flatMap((candidate, index) =>
      (anyRepo || candidate.repoName === targetRepo) && relativePath(candidate.file) === wanted ? [index] : []);
  };

  let matches: number[];
  if (isAbsoluteReference(targetFile)) {
    const wanted = toSlashes(targetFile);
    // Windows paths compare without case, as the file system does.
    const windowsStyle = /^([a-z]:|\/\/)/i.test(wanted);
    const normalize = (value: string) => (windowsStyle ? value.toLowerCase() : value);
    matches = files.flatMap((candidate, index) =>
      candidate.repoPath && normalize(joinRepoFile(candidate.repoPath, candidate.file)) === normalize(wanted) ? [index] : []);
    // A leading slash has also been used for a repository-relative path.
    if (matches.length === 0 && !windowsStyle) matches = byRelativePath();
  } else {
    matches = byRelativePath();
  }

  return matches.length === 1 ? matches[0]! : -1;
}

/** The directory name of a repository path, the form `repoName` takes. */
export function repoDirName(repoPath: string): string {
  return toSlashes(repoPath).replace(/\/+$/, '').split('/').pop() ?? '';
}
