import { execa } from 'execa';

export interface ChangedFile {
  file: string;
  type: string;
  rawStatus: string;
  additions: number;
  deletions: number;
}

export function parseGitStatus(output: string): ChangedFile[] {
  const records = output.split('\0');
  const files: ChangedFile[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (record.length < 4) continue;
    const rawStatus = record.slice(0, 2);
    // With -z, renamed/copied paths are destination NUL source NUL.
    const file = record.slice(3);
    if (/[RC]/.test(rawStatus)) index++;
    const type = rawStatus === '??' || rawStatus.includes('A') ? 'added'
      : rawStatus.includes('D') ? 'deleted' : rawStatus.includes('R') ? 'renamed' : 'modified';
    files.push({ file, rawStatus: rawStatus.trim(), type, additions: 0, deletions: 0 });
  }
  return files;
}

export async function listRepositoryChanges(repoPath: string, includeAll = false): Promise<ChangedFile[]> {
  const { stdout } = await execa('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: repoPath, stripFinalNewline: false });
  const files = parseGitStatus(stdout);
  // Disable rename folding only for line counts; status retains rename identity.
  const byPath = new Map(files.map(file => [file.file, file]));
  try {
    const stats = await execa('git', ['diff', 'HEAD', '--numstat', '-z', '--no-renames'], { cwd: repoPath, reject: false, stripFinalNewline: false });
    for (const record of stats.stdout.split('\0')) {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
      if (!match) continue;
      const file = byPath.get(match[3]!);
      if (file) { file.additions = Number(match[1]) || 0; file.deletions = Number(match[2]) || 0; }
    }
  } catch {
    // A repository without HEAD still has useful status and untracked files.
  }
  if (includeAll) {
    const listed = await execa('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repoPath, stripFinalNewline: false });
    for (const file of listed.stdout.split('\0').filter(Boolean)) {
      if (!byPath.has(file)) byPath.set(file, { file, type: 'unchanged', rawStatus: '', additions: 0, deletions: 0 });
    }
  }
  return [...byPath.values()];
}
