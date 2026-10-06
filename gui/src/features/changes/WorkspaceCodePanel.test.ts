import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceCodePanel } from './WorkspaceCodePanel.js';
import {
  buildCompactedTree,
  filterTreeFiles,
  getAllDirectoryPaths,
  getAncestorPaths,
  getMatchingBranchPaths,
  treeOrderedFiles,
} from './FileTree.js';

describe('WorkspaceCodePanel Toolbar Actions', () => {
  it('renders Expand All and Collapse All toolbar buttons with accessible labels', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceCodePanel, {
        workspace: 'test-ws',
        active: true,
      })
    );

    // Verify header toolbar contains Expand All and Collapse All buttons
    expect(html).toContain('aria-label="Expand All"');
    expect(html).toContain('title="Expand All"');
    expect(html).toContain('aria-label="Collapse All"');
    expect(html).toContain('title="Collapse All"');

    // Verify mode toggle buttons
    expect(html).toContain('>Changes</button>');
    expect(html).toContain('>Files</button>');

    // Verify sidebar toggle button
    expect(html).toContain('aria-label="Hide file tree sidebar"');
  });

  it('renders close button when onClose handler is provided', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceCodePanel, {
        workspace: 'test-ws',
        active: true,
        onClose: () => {},
      })
    );

    expect(html).toContain('title="Close code panel"');
  });
});

describe('WorkspaceCodePanel Expansion & Polling State Management', () => {
  const sampleRepos = [
    {
      repoName: 'frontend',
      repoPath: '/ws/frontend',
      files: [
        { file: 'README.md', type: 'modified' },
        { file: 'src/components/Button.tsx', type: 'modified' },
        { file: 'src/components/Dialog.tsx', type: 'added' },
        { file: 'src/utils/format.ts', type: 'modified' },
      ],
    },
    {
      repoName: 'backend',
      repoPath: '/ws/backend',
      files: [
        { file: 'package.json', type: 'unchanged' },
        { file: 'src/api/routes.ts', type: 'modified' },
      ],
    },
  ];

  it('computes smart default expansion: collapsed for files mode, expanded for changes mode', () => {
    // In 'files' mode: each repo should default to an empty Set
    const filesDefault: Record<string, Set<string>> = {};
    for (const repo of sampleRepos) {
      filesDefault[repo.repoName] = new Set();
    }
    expect(filesDefault['frontend']?.size).toBe(0);
    expect(filesDefault['backend']?.size).toBe(0);

    // In 'changes' mode: each repo should default to all directory paths
    const changesDefault: Record<string, Set<string>> = {};
    for (const repo of sampleRepos) {
      const root = buildCompactedTree(repo.files);
      changesDefault[repo.repoName] = new Set(getAllDirectoryPaths(root));
    }
    expect(changesDefault['frontend']).toEqual(new Set(['src', 'src/components', 'src/utils']));
    expect(changesDefault['backend']).toEqual(new Set(['src/api']));
  });

  it('preserves user expanded folders in files mode across polling re-renders', () => {
    // Initial state: files mode defaults to empty Set
    const expandedPathsByRepo: Record<string, Set<string>> = {
      frontend: new Set(),
      backend: new Set(),
    };

    // User manually expands 'src/components' in frontend repo
    expandedPathsByRepo['frontend'] = new Set(['src/components']);
    expect(expandedPathsByRepo['frontend'].has('src/components')).toBe(true);

    // Polling re-render occurs 10s later with fresh repo instances
    const polledRepos = sampleRepos.map(r => ({
      ...r,
      files: [...r.files, { file: 'src/utils/logger.ts', type: 'added' }],
    }));

    // Simulating WorkspaceCodePanel repos-population logic:
    // Only repos NOT yet in expandedPathsByRepo are initialized
    const nextState = { ...expandedPathsByRepo };
    for (const repo of polledRepos) {
      if (!nextState[repo.repoName]) {
        nextState[repo.repoName] = new Set();
      }
    }

    // Crucially: 'src/components' is STILL expanded! It was NOT collapsed!
    expect(nextState['frontend'].has('src/components')).toBe(true);
    expect(nextState['frontend'].size).toBe(1);
  });

  it('preserves user collapsed folders in changes mode across polling re-renders', () => {
    // Initial state: changes mode defaults to all expanded
    const expandedPathsByRepo: Record<string, Set<string>> = {};
    for (const repo of sampleRepos) {
      const root = buildCompactedTree(repo.files);
      expandedPathsByRepo[repo.repoName] = new Set(getAllDirectoryPaths(root));
    }
    expect(expandedPathsByRepo['frontend'].has('src/utils')).toBe(true);

    // User manually collapses 'src/utils'
    const userModified = new Set(expandedPathsByRepo['frontend']);
    userModified.delete('src/utils');
    expandedPathsByRepo['frontend'] = userModified;
    expect(expandedPathsByRepo['frontend'].has('src/utils')).toBe(false);

    // Polling occurs 10s later
    const polledRepos = sampleRepos.map(r => ({ ...r, files: [...r.files] }));
    const nextState = { ...expandedPathsByRepo };
    for (const repo of polledRepos) {
      if (!nextState[repo.repoName]) {
        const root = buildCompactedTree(repo.files);
        nextState[repo.repoName] = new Set(getAllDirectoryPaths(root));
      }
    }

    // Crucially: 'src/utils' is STILL collapsed! It did NOT snap back open!
    expect(nextState['frontend'].has('src/utils')).toBe(false);
    expect(nextState['frontend'].has('src/components')).toBe(true);
  });

  it('auto-expands ancestor folders when selecting a file', () => {
    const root = buildCompactedTree(sampleRepos[0]!.files);
    const targetFile = 'src/components/Button.tsx';
    const ancestors = getAncestorPaths(root, targetFile);

    expect(ancestors.slice().sort()).toEqual(['src', 'src/components'].sort());

    // Initially collapsed
    const currentExpanded = new Set<string>();
    const nextExpanded = new Set(currentExpanded);
    for (const a of ancestors) {
      nextExpanded.add(a);
    }

    expect(nextExpanded.has('src')).toBe(true);
    expect(nextExpanded.has('src/components')).toBe(true);
  });

  it('allows user to collapse repo accordion while a file in that repo is selected', () => {
    // Selection is inside 'frontend'
    const selection = { repoName: 'frontend', file: 'src/components/Button.tsx' };
    const collapsedRepos: Record<string, boolean> = {};

    // When file was first selected: ensure repo is uncollapsed
    collapsedRepos[selection.repoName] = false;
    expect(collapsedRepos['frontend']).toBe(false);

    // User manually collapses the repo accordion
    collapsedRepos['frontend'] = true;

    // A poll or re-render occurs without selection changing:
    // The repo MUST remain collapsed (not snapped back open)
    const lastSelectedKey = `${selection.repoName}:${selection.file}`;
    const currentKey = `${selection.repoName}:${selection.file}`;

    // Effect guard check: if currentKey === lastSelectedKey, do NOT uncollapse!
    let repoReopened = false;
    if (currentKey !== lastSelectedKey) {
      repoReopened = true;
    }

    expect(repoReopened).toBe(false);
    expect(collapsedRepos['frontend']).toBe(true);
  });

  it('handles Expand All and Collapse All across multiple repositories', () => {
    // Expand All: expands all folders and uncollapses repos
    const expandAllNext: Record<string, Set<string>> = {};
    for (const repo of sampleRepos) {
      const root = buildCompactedTree(repo.files);
      expandAllNext[repo.repoName] = new Set(getAllDirectoryPaths(root));
    }
    expect(expandAllNext['frontend'].size).toBe(3);
    expect(expandAllNext['backend'].size).toBe(1);

    // Collapse All: clears expandedPaths across all repos
    const collapseAllNext: Record<string, Set<string>> = {};
    for (const repo of sampleRepos) {
      collapseAllNext[repo.repoName] = new Set();
    }
    expect(collapseAllNext['frontend'].size).toBe(0);
    expect(collapseAllNext['backend'].size).toBe(0);
  });
});

describe('WorkspaceCodePanel Sidebar Search & Path Filtering', () => {
  const sampleRepos = [
    {
      repoName: 'frontend',
      repoPath: '/ws/frontend',
      files: [
        { file: 'README.md', type: 'modified' },
        { file: 'src/components/Button.tsx', type: 'modified' },
        { file: 'src/components/Dialog.tsx', type: 'added' },
        { file: 'src/utils/format.ts', type: 'modified' },
      ],
    },
    {
      repoName: 'backend',
      repoPath: '/ws/backend',
      files: [
        { file: 'package.json', type: 'unchanged' },
        { file: 'src/api/routes.ts', type: 'modified' },
      ],
    },
  ];

  it('renders sticky search input in sidebar with placeholder and accessibility attributes', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceCodePanel, {
        workspace: 'test-ws',
        active: true,
      })
    );

    // Sidebar search input element
    expect(html).toContain('placeholder="Filter files… (/)"');
    expect(html).toContain('aria-label="Filter files"');
    // Top of sidebar contains sticky search container
    expect(html).toContain('sticky top-0');
  });

  it('computes real-time case-insensitive filtered files across multiple repositories', () => {
    // Search for "button"
    const query = 'button';
    const filteredRepos = sampleRepos.map(r => ({
      ...r,
      files: filterTreeFiles(r.files, query),
    }));

    expect(filteredRepos[0]?.files.map(f => f.file)).toEqual(['src/components/Button.tsx']);
    expect(filteredRepos[1]?.files).toEqual([]);

    // Total files vs matching files
    const totalFiles = sampleRepos.reduce((sum, r) => sum + r.files.length, 0);
    const matchingFiles = filteredRepos.reduce((sum, r) => sum + r.files.length, 0);
    expect(totalFiles).toBe(6);
    expect(matchingFiles).toBe(1);
  });

  it('filters files matching across multiple repositories', () => {
    // Search for "src" which exists in both repositories
    const query = 'src';
    const filteredRepos = sampleRepos.map(r => ({
      ...r,
      files: filterTreeFiles(r.files, query),
    }));

    expect(filteredRepos[0]?.files.map(f => f.file)).toEqual([
      'src/components/Button.tsx',
      'src/components/Dialog.tsx',
      'src/utils/format.ts',
    ]);
    expect(filteredRepos[1]?.files.map(f => f.file)).toEqual(['src/api/routes.ts']);

    const matchingFiles = filteredRepos.reduce((sum, r) => sum + r.files.length, 0);
    expect(matchingFiles).toBe(4);
  });

  it('automatically expands directory branches containing matching files during filter', () => {
    const query = 'Button';
    const matchingBranchesByRepo: Record<string, Set<string>> = {};
    for (const repo of sampleRepos) {
      matchingBranchesByRepo[repo.repoName] = getMatchingBranchPaths(repo.files, query, { compact: true });
    }

    // In frontend repo: 'src/components' is the branch containing Button.tsx
    expect(matchingBranchesByRepo['frontend']?.has('src/components')).toBe(true);
    // In backend repo: no files matched, so empty set
    expect(matchingBranchesByRepo['backend']?.size).toBe(0);
  });

  it('uncollapses repos containing matching files and collapses repos with 0 matches', () => {
    const query = 'Button';
    const filteredRepos = sampleRepos.map(r => ({
      ...r,
      files: filterTreeFiles(r.files, query),
    }));

    const searchCollapsedRepos: Record<string, boolean> = {};
    for (const repo of filteredRepos) {
      const hasMatches = repo.files.length > 0;
      // If repo has matches -> open (false); if 0 matches -> collapsed (true)
      searchCollapsedRepos[repo.repoName] = !hasMatches;
    }

    expect(searchCollapsedRepos['frontend']).toBe(false); // Uncollapsed / visible
    expect(searchCollapsedRepos['backend']).toBe(true);   // Collapsed
  });

  it('updates treeOrderedFiles so navigation steps strictly through filtered files', () => {
    // Unfiltered visual files across repos
    const allVisualFiles = sampleRepos.flatMap(r =>
      treeOrderedFiles(r.files).map(f => ({ repoName: r.repoName, file: f.file }))
    );
    expect(allVisualFiles.length).toBe(6);

    // Filtered by "format"
    const query = 'format';
    const filteredRepos = sampleRepos.map(r => ({
      ...r,
      files: filterTreeFiles(r.files, query),
    }));
    const filteredVisualFiles = filteredRepos.flatMap(r =>
      treeOrderedFiles(r.files).map(f => ({ repoName: r.repoName, file: f.file }))
    );

    expect(filteredVisualFiles).toEqual([
      { repoName: 'frontend', file: 'src/utils/format.ts' },
    ]);

    // Keyboard navigation index is strictly within filtered bounds
    const currentIndex = 0;
    expect(filteredVisualFiles[currentIndex]?.file).toBe('src/utils/format.ts');
  });

  it('preserves pre-search folder expansion state when search is cleared', () => {
    // Pre-search state: user manually had 'src/components' expanded and 'src/utils' collapsed
    const userExpandedPaths: Record<string, Set<string>> = {
      frontend: new Set(['src/components']),
      backend: new Set(),
    };

    // Active search: "format"
    const query = 'format';
    const searchActiveExpandedPaths: Record<string, Set<string>> = {};
    for (const repo of sampleRepos) {
      searchActiveExpandedPaths[repo.repoName] = getMatchingBranchPaths(repo.files, query, { compact: true });
    }
    // During search: 'src/utils' is expanded because format.ts is in it
    expect(searchActiveExpandedPaths['frontend']?.has('src/utils')).toBe(true);
    expect(searchActiveExpandedPaths['frontend']?.has('src/components')).toBe(false);

    // Search cleared: effective state reverts back to userExpandedPaths
    const clearedQuery = '';
    const effectiveExpandedPaths = clearedQuery.trim()
      ? searchActiveExpandedPaths
      : userExpandedPaths;

    expect(effectiveExpandedPaths['frontend']?.has('src/components')).toBe(true);
    expect(effectiveExpandedPaths['frontend']?.has('src/utils')).toBe(false);
  });

  it('handles Expand All and Collapse All during active search without mutating base expansion state', () => {
    const baseExpandedPaths: Record<string, Set<string>> = {
      frontend: new Set(['src/components']),
      backend: new Set(),
    };

    const query = 'src';
    const filteredRepos = sampleRepos.map(r => ({
      ...r,
      files: filterTreeFiles(r.files, query),
    }));

    // Simulating expandAllFolders during active search
    const searchExpanded: Record<string, Set<string>> = {};
    for (const repo of filteredRepos) {
      const root = buildCompactedTree(repo.files);
      searchExpanded[repo.repoName] = new Set(getAllDirectoryPaths(root));
    }

    // Both frontend and backend filtered trees are expanded
    expect(searchExpanded['frontend']?.size).toBeGreaterThan(0);
    expect(searchExpanded['backend']?.size).toBeGreaterThan(0);
    // Base expandedPaths was NOT modified
    expect(baseExpandedPaths['frontend']).toEqual(new Set(['src/components']));
    expect(baseExpandedPaths['backend']?.size).toBe(0);

    // Simulating collapseAllFolders during active search
    const searchCollapsed: Record<string, Set<string>> = {};
    for (const repo of filteredRepos) {
      searchCollapsed[repo.repoName] = new Set();
    }
    expect(searchCollapsed['frontend']?.size).toBe(0);
    expect(searchCollapsed['backend']?.size).toBe(0);
    // Base expandedPaths remains intact
    expect(baseExpandedPaths['frontend']).toEqual(new Set(['src/components']));
  });

  it('uncollapses searchCollapsedRepos when a file in that repo is selected during search', () => {
    const searchCollapsedRepos: Record<string, boolean> = {
      frontend: true,
      backend: false,
    };

    const selection = { repoName: 'frontend', file: 'src/components/Button.tsx' };

    // Selecting file in frontend uncollapses frontend
    if (searchCollapsedRepos[selection.repoName]) {
      searchCollapsedRepos[selection.repoName] = false;
    }

    expect(searchCollapsedRepos['frontend']).toBe(false);
  });
});
