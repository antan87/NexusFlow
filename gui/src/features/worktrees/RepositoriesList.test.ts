import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { hasUnpreparedRepo as needsPreparing } from './normalizeWorktrees';
import { RepositoriesList } from './RepositoriesList';
import type { RepoWorktreeGroup, WorktreeDescriptor } from './types';

const worktree = (extra: Partial<WorktreeDescriptor> = {}): WorktreeDescriptor => ({
  id: 'wt', repoName: 'api', repoPath: '/dev/api', branchName: 'feat/x', title: 't', commitSha: '', dirtyFilesCount: 0, status: 'clean',
  isPinned: false, isHostReadOnly: false, worktreePath: '/ws/api', ...extra,
});
const group = (repoName: string, extra: Partial<RepoWorktreeGroup> = {}, wt: Partial<WorktreeDescriptor> = {}): RepoWorktreeGroup =>
  ({ repoName, repoPath: `/dev/${repoName}`, isHostRepo: false, worktrees: [worktree({ repoName, ...wt })], ...extra });
const render = (groups: RepoWorktreeGroup[], onPrepare?: (repo: string) => void) => renderToStaticMarkup(createElement(RepositoriesList, { groups, onPrepare }));

describe('needsPreparing', () => {
  it('is true only when a repository is itself still the user\'s own checkout', () => {
    expect(needsPreparing([group('docs', { isHostRepo: true })])).toBe(true);
    expect(needsPreparing([group('api'), group('docs', { isHostRepo: true })])).toBe(true);
    expect(needsPreparing([group('api')])).toBe(false);
    expect(needsPreparing([])).toBe(false);
  });

  it('is not set off by the read-only baseline that sits beside an editable copy', () => {
    const editable = group('api', {}, {});
    editable.worktrees.push(worktree({ id: 'host', isHostReadOnly: true, branchName: 'origin/main' }));
    expect(needsPreparing([editable])).toBe(false);
  });
});

describe('RepositoriesList', () => {
  it('shows one plain line per repository with its branch and state', () => {
    const html = render([group('api', {}, { branchName: 'feat/x', dirtyFilesCount: 0 }), group('web', {}, { branchName: 'main', dirtyFilesCount: 3 })]);
    expect((html.match(/<li/g) ?? []).length).toBe(2);
    expect(html).toContain('feat/x');
    expect(html).toContain('clean');
    expect(html).toContain('3 changed');
    // The baseline beside an editable copy is not listed as a second line.
    expect(html).not.toContain('Host Baseline');
  });

  it('offers to prepare only a repository that is still the user\'s checkout, and says it is read-only', () => {
    const html = render([group('api'), group('docs', { isHostRepo: true }, { branchName: 'main', dirtyFilesCount: null })], () => undefined);
    expect(html).toContain('read-only');
    expect(html).toContain('aria-label="Prepare docs for editing"');
    expect(html).not.toContain('aria-label="Prepare api for editing"');
  });

  it('offers nothing to prepare when no handler is given, and says so when there are no repositories', () => {
    expect(render([group('docs', { isHostRepo: true })])).not.toContain('Prepare docs for editing');
    expect(render([])).toContain('No repositories.');
  });

  it('shows an unknown change count as nothing rather than a guess', () => {
    const html = render([group('api', {}, { dirtyFilesCount: null })]);
    expect(html).not.toContain('clean');
    expect(html).not.toContain('changed');
  });

  it('shows names as text, never as markup', () => {
    const html = render([group('<img src=x onerror=alert(1)>')]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
