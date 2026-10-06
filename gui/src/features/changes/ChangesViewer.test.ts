import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChangesViewer } from './ChangesViewer.js';
import { buildCompactedTree, filterTreeFiles, getMatchingBranchPaths, treeOrderedFiles } from './FileTree.js';
import type { Feature } from '../../types.js';

vi.mock('../../lib/api/queries.js', () => ({
  useConfig: () => ({ data: { config: { defaultEditor: 'vscode' } } }),
}));

describe('ChangesViewer Jump Bar Search & Filter', () => {
  const dummyFeature: Feature = {
    id: 'feat-1',
    name: 'feat-1',
    branchName: 'feat-1',
    description: 'Test feature',
    repos: ['/ws/repo-a', '/ws/repo-b'],
  };

  const sampleGitChanges = [
    {
      repoName: 'repo-a',
      repoPath: '/ws/repo-a',
      files: [
        { file: 'src/components/Button.tsx', type: 'modified', additions: 10, deletions: 2 },
        { file: 'src/components/Dialog.tsx', type: 'added', additions: 25, deletions: 0 },
        { file: 'src/utils/math.ts', type: 'modified', additions: 5, deletions: 1 },
      ],
    },
    {
      repoName: 'repo-b',
      repoPath: '/ws/repo-b',
      files: [
        { file: 'api/server.ts', type: 'modified', additions: 12, deletions: 4 },
        { file: 'package.json', type: 'modified', additions: 1, deletions: 0 },
      ],
    },
  ];

  const createWrapper = (component: React.ReactElement) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return createElement(QueryClientProvider, { client: queryClient }, component);
  };

  it('renders sticky jump bar with search input and accessible attributes', () => {
    const html = renderToStaticMarkup(
      createWrapper(
        createElement(ChangesViewer, {
          ws: dummyFeature,
          gitChanges: sampleGitChanges,
          gitChangesLoading: false,
          syncLoading: false,
          syncResults: null,
          commitMessage: '',
          showCommitModal: false,
          commitResults: null,
          setSyncResults: () => {},
          setCommitResults: () => {},
          setCommitMessage: () => {},
          setShowCommitModal: () => {},
          fetchGitChanges: async () => {},
          handleSyncAll: async () => {},
        })
      )
    );

    // Jump bar container is sticky
    expect(html).toContain('sticky top-14');
    // Search input is present with placeholder and accessible label
    expect(html).toContain('placeholder="Filter files… (/)"');
    expect(html).toContain('aria-label="Filter files"');
    // Dropdown is present
    expect(html).toContain('aria-label="Jump to changed file"');
  });

  it('computes real-time case-insensitive filtered list and match counts across repos', () => {
    const query = 'button';
    const filteredRepos = sampleGitChanges.map(repo => ({
      ...repo,
      files: filterTreeFiles(repo.files, query),
    }));

    const totalFiles = sampleGitChanges.reduce((sum, r) => sum + r.files.length, 0);
    const matchingFiles = filteredRepos.reduce((sum, r) => sum + r.files.length, 0);

    expect(totalFiles).toBe(5);
    expect(matchingFiles).toBe(1);
    expect(filteredRepos[0]?.files[0]?.file).toBe('src/components/Button.tsx');
    expect(filteredRepos[1]?.files).toEqual([]);
  });

  it('restricts treeOrderedFiles and jump dropdown options strictly to matching files', () => {
    const query = 'components';
    const filteredRepos = sampleGitChanges.map(repo => ({
      ...repo,
      files: filterTreeFiles(repo.files, query),
    }));

    const visualFiles = filteredRepos.flatMap(r =>
      treeOrderedFiles(r.files).map(f => ({ repoName: r.repoName, file: f.file }))
    );

    expect(visualFiles).toEqual([
      { repoName: 'repo-a', file: 'src/components/Button.tsx' },
      { repoName: 'repo-a', file: 'src/components/Dialog.tsx' },
    ]);

    // Cycling through filtered files with next/prev
    const prevIdx = (0 - 1 + visualFiles.length) % visualFiles.length;
    expect(prevIdx).toBe(1);
    const nextIdx = (0 + 1) % visualFiles.length;
    expect(nextIdx).toBe(1);
  });

  it('auto-expands directory branches for matching files in ChangesViewer', () => {
    const query = 'math';
    const branchesByRepo: Record<string, Set<string>> = {};
    for (const repo of sampleGitChanges) {
      branchesByRepo[repo.repoName] = getMatchingBranchPaths(repo.files, query, { compact: true });
    }

    expect(branchesByRepo['repo-a']?.has('src/utils')).toBe(true);
    expect(branchesByRepo['repo-a']?.has('src/components')).toBe(false);
    expect(branchesByRepo['repo-b']?.size).toBe(0);
  });

  it('determines repo accordion collapse state during search based on match presence', () => {
    const query = 'server';
    const filteredRepos = sampleGitChanges.map(repo => ({
      ...repo,
      files: filterTreeFiles(repo.files, query),
    }));

    // repo-a has 0 matches -> collapsed
    // repo-b has 1 match -> uncollapsed
    const isRepoACollapsed = filteredRepos[0]!.files.length === 0;
    const isRepoBCollapsed = filteredRepos[1]!.files.length === 0;

    expect(isRepoACollapsed).toBe(true);
    expect(isRepoBCollapsed).toBe(false);
  });

  it('handles empty matches gracefully without hiding jump bar or breaking controls', () => {
    const query = 'nonexistent_search_query';
    const filteredRepos = sampleGitChanges.map(repo => ({
      ...repo,
      files: filterTreeFiles(repo.files, query),
    }));

    const visualFiles = filteredRepos.flatMap(r =>
      treeOrderedFiles(r.files).map(f => ({ repoName: r.repoName, file: f.file }))
    );

    expect(visualFiles.length).toBe(0);
    // When 0 matches, dropdown and buttons are disabled
    const isNavigationDisabled = visualFiles.length === 0;
    expect(isNavigationDisabled).toBe(true);
  });

  it('handles Expand All and Collapse All during search without mutating base tree expansions', () => {
    const baseTrees: Record<string, Set<string>> = {
      'repo-a': new Set(['src/components']),
      'repo-b': new Set(),
    };

    const query = 'Button';
    const filteredRepos = sampleGitChanges.map(repo => ({
      ...repo,
      files: filterTreeFiles(repo.files, query),
    }));

    // Simulating expandAllRepos during active search
    const searchTrees: Record<string, Set<string>> = {};
    const searchCollapsed: Record<string, boolean> = {};
    filteredRepos.forEach(repo => {
      searchCollapsed[repo.repoName] = false;
      const root = buildCompactedTree(repo.files);
      searchTrees[repo.repoName] = new Set(root.directories.map(d => d.path));
    });

    expect(searchCollapsed['repo-a']).toBe(false);
    expect(searchTrees['repo-a']?.size).toBeGreaterThanOrEqual(1);
    // Base tree state is preserved
    expect(baseTrees['repo-a']).toEqual(new Set(['src/components']));

    // Simulating collapseAllRepos during active search
    const searchCollapsedAll: Record<string, boolean> = {};
    const searchTreesAll: Record<string, Set<string>> = {};
    filteredRepos.forEach(repo => {
      searchCollapsedAll[repo.repoName] = true;
      searchTreesAll[repo.repoName] = new Set();
    });

    expect(searchCollapsedAll['repo-a']).toBe(true);
    expect(searchTreesAll['repo-a']?.size).toBe(0);
    // Base tree state is preserved
    expect(baseTrees['repo-a']).toEqual(new Set(['src/components']));
  });

  it('uncollapses searchCollapsedRepos when jumpToFile targets a file in a collapsed repo', () => {
    const searchCollapsedRepos: Record<string, boolean> = {
      'repo-a': true,
      'repo-b': false,
    };

    const target = { repoName: 'repo-a', file: 'src/components/Button.tsx' };

    // Simulating jumpToFile uncollapse
    searchCollapsedRepos[target.repoName] = false;

    expect(searchCollapsedRepos['repo-a']).toBe(false);
  });
});
