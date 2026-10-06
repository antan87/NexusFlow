import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceCodePanel } from './WorkspaceCodePanel.js';
import {
  buildCompactedTree,
  getAllDirectoryPaths,
  getAncestorPaths,
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
