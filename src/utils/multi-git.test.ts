import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execa } from 'execa';
import {
  rebaseRepo,
  getRepoBranch,
  getAheadBehind,
  getRemoteUrl,
  pushRepo,
} from './multi-git.js';

vi.mock('execa');

/** Builds an execa-style error carrying stderr (as execa does on non-zero exit). */
function gitError(stderr: string): Error {
  return Object.assign(new Error('git failed'), { stderr });
}

interface GitMockOpts {
  fetchError?: Error;
  statusStdout?: string;      // output of `git status --porcelain` ('' = clean)
  stashPushError?: Error;
  stashPopError?: Error;
  rebaseError?: Error;
  rebaseStdout?: string;
}

/** Resolves a single mocked `git` call by subcommand. */
async function routeGit(a: string[], opts: GitMockOpts): Promise<{ stdout: string }> {
  const sub = a[0];
  if (sub === 'fetch') {
    if (opts.fetchError) throw opts.fetchError;
    return { stdout: '' };
  }
  if (sub === 'status') {
    return { stdout: opts.statusStdout ?? '' };
  }
  if (sub === 'stash' && a[1] === 'push') {
    if (opts.stashPushError) throw opts.stashPushError;
    return { stdout: '' };
  }
  if (sub === 'stash' && a[1] === 'pop') {
    if (opts.stashPopError) throw opts.stashPopError;
    return { stdout: '' };
  }
  if (sub === 'rebase' && a[1] === '--abort') {
    return { stdout: '' };
  }
  if (sub === 'rebase') {
    if (opts.rebaseError) throw opts.rebaseError;
    return { stdout: opts.rebaseStdout ?? 'Successfully rebased.' };
  }
  return { stdout: '' };
}

/** Routes mocked `git` calls by subcommand so each test declares only what matters. */
function mockGit(opts: GitMockOpts): void {
  vi.mocked(execa).mockImplementation(((_file: any, args: any) =>
    routeGit(args as string[], opts)) as any);
}

/** Returns the recorded execa calls as arrays of git args. */
function gitCalls(): string[][] {
  return vi.mocked(execa).mock.calls.map((c) => c[1] as string[]);
}

describe('rebaseRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports "rebased" for a clean tree with new base commits', async () => {
    mockGit({ statusStdout: '', rebaseStdout: 'Successfully rebased and updated.' });

    const result = await rebaseRepo('/repo', 'main');

    expect(result.success).toBe(true);
    expect(result.status).toBe('rebased');
    expect(result.stashed).toBeFalsy();
    // No stash should be created for a clean tree.
    expect(gitCalls().some((c) => c[0] === 'stash')).toBe(false);
  });

  it('reports "up-to-date" when already current', async () => {
    mockGit({ statusStdout: '', rebaseStdout: 'Current branch feature is up to date.' });

    const result = await rebaseRepo('/repo', 'main');

    expect(result.success).toBe(true);
    expect(result.status).toBe('up-to-date');
  });

  it('auto-stashes a dirty tree and restores it (the regression fix)', async () => {
    mockGit({ statusStdout: ' M src/app.ts\n', rebaseStdout: 'Successfully rebased.' });

    const result = await rebaseRepo('/repo', 'main');

    expect(result.success).toBe(true);
    expect(result.status).toBe('rebased');
    expect(result.stashed).toBe(true);

    const calls = gitCalls();
    // Stash push (with untracked) before rebase, stash pop after.
    expect(calls).toContainEqual(['stash', 'push', '-u', '-m', 'nexusflow-autostash']);
    expect(calls).toContainEqual(['stash', 'pop']);
  });

  it('classifies a fetch failure as "error", not a conflict', async () => {
    mockGit({ fetchError: gitError('fatal: unable to access origin: Could not resolve host') });

    const result = await rebaseRepo('/repo', 'main');

    expect(result.success).toBe(false);
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/^Fetch failed:/);
    expect(result.conflict).toBeUndefined();
    // Should never attempt a rebase if fetch failed.
    expect(gitCalls().some((c) => c[0] === 'rebase')).toBe(false);
  });

  it('classifies a real merge conflict as "conflict" and aborts', async () => {
    mockGit({
      statusStdout: '',
      rebaseError: gitError('CONFLICT (content): Merge conflict in src/app.ts'),
    });

    const result = await rebaseRepo('/repo', 'main');

    expect(result.success).toBe(false);
    expect(result.status).toBe('conflict');
    expect(result.conflict).toContain('CONFLICT');
    expect(gitCalls()).toContainEqual(['rebase', '--abort']);
  });

  it('restores the stash after aborting a conflicting rebase on a dirty tree', async () => {
    mockGit({
      statusStdout: ' M src/app.ts\n',
      rebaseError: gitError('CONFLICT (content): Merge conflict'),
    });

    const result = await rebaseRepo('/repo', 'main');

    expect(result.status).toBe('conflict');
    expect(result.stashed).toBe(true);
    const calls = gitCalls();
    expect(calls).toContainEqual(['rebase', '--abort']);
    expect(calls).toContainEqual(['stash', 'pop']); // local work restored
  });

  it('reports "stash-conflict" when the rebase lands but the stash pop conflicts', async () => {
    mockGit({
      statusStdout: ' M src/app.ts\n',
      rebaseStdout: 'Successfully rebased.',
      stashPopError: gitError('CONFLICT (content): Merge conflict in src/app.ts'),
    });

    const result = await rebaseRepo('/repo', 'main');

    // The rebase itself succeeded, so success is true, but it needs attention.
    expect(result.success).toBe(true);
    expect(result.status).toBe('stash-conflict');
    expect(result.stashed).toBe(true);
    expect(result.message).toMatch(/stash preserved/i);
  });
});

describe('getRepoBranch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the current branch name', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'feature/foo\n' } as any);
    expect(await getRepoBranch('/repo')).toBe('feature/foo');
  });

  it('returns null for a detached HEAD', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'HEAD\n' } as any);
    expect(await getRepoBranch('/repo')).toBeNull();
  });

  it('returns null when git fails', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('not a repo'));
    expect(await getRepoBranch('/repo')).toBeNull();
  });
});

describe('getAheadBehind', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses behind/ahead counts from rev-list --left-right', async () => {
    // Output is "<behind>\t<ahead>".
    vi.mocked(execa).mockResolvedValue({ stdout: '2\t3\n' } as any);
    expect(await getAheadBehind('/repo', 'main')).toEqual({ ahead: 3, behind: 2 });
  });

  it('returns nulls when the remote branch does not exist', async () => {
    vi.mocked(execa).mockRejectedValue(new Error("unknown revision 'origin/main'"));
    expect(await getAheadBehind('/repo', 'main')).toEqual({ ahead: null, behind: null });
  });
});

describe('getRemoteUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the remote URL', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: 'git@github.com:owner/repo.git\n' } as any);
    expect(await getRemoteUrl('/repo')).toBe('git@github.com:owner/repo.git');
  });

  it('returns null when the remote does not exist', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('No such remote'));
    expect(await getRemoteUrl('/repo')).toBeNull();
  });
});

describe('pushRepo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pushes with -u and reports success', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    const result = await pushRepo('/repo', 'feature/foo');
    expect(result.success).toBe(true);
    expect(execa).toHaveBeenCalledWith('git', ['push', '-u', 'origin', 'feature/foo'], { cwd: '/repo' });
  });

  it('reports failure with the first line of the error', async () => {
    vi.mocked(execa).mockRejectedValue(
      Object.assign(new Error('git failed'), { stderr: 'fatal: no upstream\nmore detail' }),
    );
    const result = await pushRepo('/repo', 'feature/foo');
    expect(result.success).toBe(false);
    expect(result.message).toBe('fatal: no upstream');
  });
});
