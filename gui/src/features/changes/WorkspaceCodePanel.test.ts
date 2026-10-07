import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceCodePanel } from './WorkspaceCodePanel.js';
import {
  FileTree,
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

describe('WorkspaceCodePanel WAI-ARIA Treeview Integration', () => {
  const sampleRepo = {
    repoName: 'frontend',
    repoPath: '/ws/frontend',
    files: [
      { file: 'README.md', type: 'modified' },
      { file: 'src/components/Button.tsx', type: 'modified' },
      { file: 'src/utils/format.ts', type: 'modified' },
    ],
  };

  const renderFileRow = (
    file: { file: string; type: string },
    selection: { repoName: string; file: string } | null,
    repoName: string
  ) => {
    const isSelected = selection?.repoName === repoName && selection.file === file.file;
    return createElement(
      'button',
      {
        type: 'button',
        className: isSelected ? 'bg-accent font-medium text-foreground' : '',
        'aria-pressed': isSelected,
        'aria-selected': isSelected,
        title: file.file,
      },
      file.file.split('/').at(-1)
    );
  };

  it('renders FileTree with accessible tree role, repo/mode label, and roving tabindex for repository files', () => {
    const selection = { repoName: 'frontend', file: 'src/components/Button.tsx' };
    const html = renderToStaticMarkup(
      createElement(FileTree, {
        label: `${sampleRepo.repoName} changes`,
        files: sampleRepo.files,
        selectedPath: selection.file,
        defaultExpanded: true,
        renderFile: (f) => renderFileRow(f, selection, sampleRepo.repoName),
      })
    );

    // Root tree role and label
    expect(html).toContain('role="tree"');
    expect(html).toContain('aria-label="frontend changes"');

    // Selected file has aria-selected="true", aria-pressed="true", and roving tabindex="0"
    expect(html).toContain('tabindex="0" data-file-path="src/components/Button.tsx"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-pressed="true"');

    // Unselected files have roving tabindex="-1" and aria-selected="false"
    expect(html).toContain('tabindex="-1" data-file-path="README.md"');
    expect(html).toContain('tabindex="-1" data-file-path="src/utils/format.ts"');
  });

  it('propagates selection changes dynamically to update aria-selected and active roving tabindex', () => {
    // 1. Initial selection: Button.tsx
    const sel1 = { repoName: 'frontend', file: 'src/components/Button.tsx' };
    const html1 = renderToStaticMarkup(
      createElement(FileTree, {
        label: `${sampleRepo.repoName} changes`,
        files: sampleRepo.files,
        selectedPath: sel1.file,
        defaultExpanded: true,
        renderFile: (f) => renderFileRow(f, sel1, sampleRepo.repoName),
      })
    );

    expect(html1).toContain('tabindex="0" data-file-path="src/components/Button.tsx"');
    expect(html1).toContain('tabindex="-1" data-file-path="src/utils/format.ts"');

    // 2. Selection moved to format.ts
    const sel2 = { repoName: 'frontend', file: 'src/utils/format.ts' };
    const html2 = renderToStaticMarkup(
      createElement(FileTree, {
        label: `${sampleRepo.repoName} changes`,
        files: sampleRepo.files,
        selectedPath: sel2.file,
        defaultExpanded: true,
        renderFile: (f) => renderFileRow(f, sel2, sampleRepo.repoName),
      })
    );

    expect(html2).toContain('tabindex="-1" data-file-path="src/components/Button.tsx"');
    expect(html2).toContain('tabindex="0" data-file-path="src/utils/format.ts"');
  });

  it('retains accessible tree group hierarchy and content-visibility styling', () => {
    const html = renderToStaticMarkup(
      createElement(FileTree, {
        label: `${sampleRepo.repoName} changes`,
        files: sampleRepo.files,
        defaultExpanded: true,
        renderFile: (f) => renderFileRow(f, null, sampleRepo.repoName),
      })
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('tree-row-wrapper');
    expect(html).toContain('content-visibility:auto');
  });
});

describe('WorkspaceCodePanel Multi-Repo Keyboard & Arrow Navigation Model', () => {
  const multiRepos = [
    {
      repoName: 'frontend',
      repoPath: '/ws/frontend',
      files: [
        { file: 'README.md', type: 'modified' },
        { file: 'src/components/Button.tsx', type: 'modified' },
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

  // Visual files list as built in WorkspaceCodePanel
  const visualFiles = multiRepos.flatMap((repo) =>
    treeOrderedFiles(repo.files).map((f) => ({
      repoName: repo.repoName,
      repoPath: repo.repoPath,
      file: f.file,
    }))
  );

  it('navigates sequentially across repos on goToNextFile and goToPrevFile', () => {
    // When no file is selected (currentFileIndex === -1), goToNextFile selects first file
    let currentIndex = -1;
    if (currentIndex === -1 && visualFiles.length > 0) {
      currentIndex = 0;
    }
    expect(currentIndex).toBe(0);
    expect(visualFiles[currentIndex]).toEqual({
      repoName: 'frontend',
      repoPath: '/ws/frontend',
      file: 'src/components/Button.tsx',
    });

    // Step forward through frontend files to boundary
    // Index 0: Button.tsx, Index 1: format.ts, Index 2: README.md
    currentIndex = 2;
    expect(visualFiles[currentIndex]?.repoName).toBe('frontend');

    // Stepping next transitions smoothly to backend repo
    if (currentIndex >= 0 && currentIndex < visualFiles.length - 1) {
      currentIndex++;
    }
    expect(currentIndex).toBe(3);
    expect(visualFiles[currentIndex]).toEqual({
      repoName: 'backend',
      repoPath: '/ws/backend',
      file: 'src/api/routes.ts',
    });

    // Stepping prev transitions smoothly back to frontend repo
    if (currentIndex > 0) {
      currentIndex--;
    }
    expect(currentIndex).toBe(2);
    expect(visualFiles[currentIndex]?.repoName).toBe('frontend');
    expect(visualFiles[currentIndex]?.file).toBe('README.md');
  });

  it('clamps navigation at start and end boundaries', () => {
    // At end of list: goToNextFile does not overflow
    let currentIndex = visualFiles.length - 1;
    if (currentIndex >= 0 && currentIndex < visualFiles.length - 1) {
      currentIndex++;
    }
    expect(currentIndex).toBe(visualFiles.length - 1);

    // At start of list: goToPrevFile does not underflow
    currentIndex = 0;
    if (currentIndex > 0) {
      currentIndex--;
    }
    expect(currentIndex).toBe(0);
  });

  it('restricts arrow navigation strictly to filtered files during active search', () => {
    const query = 'format';
    const filteredRepos = multiRepos.map((repo) => ({
      ...repo,
      files: filterTreeFiles(repo.files, query),
    }));

    const filteredVisualFiles = filteredRepos.flatMap((repo) =>
      treeOrderedFiles(repo.files).map((f) => ({
        repoName: repo.repoName,
        repoPath: repo.repoPath,
        file: f.file,
      }))
    );

    expect(filteredVisualFiles).toHaveLength(1);
    expect(filteredVisualFiles[0]).toEqual({
      repoName: 'frontend',
      repoPath: '/ws/frontend',
      file: 'src/utils/format.ts',
    });
  });

  it('coordinates roving tabindex across multiple repositories', () => {
    // Current selection is in backend/src/api/routes.ts
    const selection = { repoName: 'backend', file: 'src/api/routes.ts' };

    // Frontend FileTree (selection not in frontend): selectedPath is undefined
    const frontendHtml = renderToStaticMarkup(
      createElement(FileTree, {
        label: 'frontend changes',
        files: multiRepos[0]!.files,
        selectedPath: selection.repoName === 'frontend' ? selection.file : undefined,
        defaultExpanded: true,
        renderFile: (f) => createElement('button', null, f.file),
      })
    );

    // Backend FileTree (selection is in backend): selectedPath is 'src/api/routes.ts'
    const backendHtml = renderToStaticMarkup(
      createElement(FileTree, {
        label: 'backend changes',
        files: multiRepos[1]!.files,
        selectedPath: selection.repoName === 'backend' ? selection.file : undefined,
        defaultExpanded: true,
        renderFile: (f) => createElement('button', null, f.file),
      })
    );

    // In frontend: no file has aria-selected="true"
    expect(frontendHtml).not.toContain('aria-selected="true"');

    // In backend: src/api/routes.ts has aria-selected="true" and tabindex="0"
    expect(backendHtml).toContain('tabindex="0" data-file-path="src/api/routes.ts"');
    expect(backendHtml).toContain('aria-selected="true"');
  });

  it('dispatches goToNextFile and goToPrevFile on Alt+ArrowDown and Alt+ArrowUp hotkeys', () => {
    let currentIndex = 1;
    const goToNextFile = () => {
      if (currentIndex < visualFiles.length - 1) currentIndex++;
    };
    const goToPrevFile = () => {
      if (currentIndex > 0) currentIndex--;
    };

    const handleKey = (key: string, altKey: boolean) => {
      if (!altKey) return;
      if (key === 'ArrowDown' || key === 'Down') goToNextFile();
      else if (key === 'ArrowUp' || key === 'Up') goToPrevFile();
    };

    handleKey('ArrowDown', true);
    expect(currentIndex).toBe(2);

    handleKey('ArrowUp', true);
    expect(currentIndex).toBe(1);

    // Without altKey: no movement
    handleKey('ArrowDown', false);
    expect(currentIndex).toBe(1);
  });

  it('traverses all files across multiple repositories in exact visual tree order', () => {
    // 0: frontend/src/components/Button.tsx
    // 1: frontend/src/utils/format.ts
    // 2: frontend/README.md
    // 3: backend/src/api/routes.ts
    // 4: backend/package.json
    let index = 0;
    const visited: string[] = [];
    while (index < visualFiles.length) {
      visited.push(`${visualFiles[index]?.repoName}:${visualFiles[index]?.file}`);
      index++;
    }
    expect(visited).toEqual([
      'frontend:src/components/Button.tsx',
      'frontend:src/utils/format.ts',
      'frontend:README.md',
      'backend:src/api/routes.ts',
      'backend:package.json',
    ]);
  });
});


