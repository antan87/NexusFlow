import { describe, it, expect } from 'vitest';
import { buildWorkspaceIndex } from './index.js';
import type { WorkspaceContext } from '../types.js';

describe('buildWorkspaceIndex', () => {
  function dummyContext(repos: Array<{ name: string; path: string }> = []): WorkspaceContext {
    return {
      feature: {
        id: 'sample-feature',
        branchName: 'feat/sample',
        description: 'Sample feature description for testing',
        repos: repos.map((r) => r.path),
        assistants: ['claude'],
        workspacePath: '/tmp/workspaces/sample',
        createdAt: new Date().toISOString(),
      },
      repos,
    };
  }

  it('describes AGENTS.md canonical role and Claude Code fallback semantics', () => {
    const ctx = dummyContext();
    const content = buildWorkspaceIndex(ctx);

    expect(content).toContain('> Assistant context lives in **AGENTS.md**.');
    expect(content).toContain('Claude Code falls back to it or reads `CLAUDE.md` (which imports it)');
    expect(content).toContain('This file is just\n> an index for people.');
  });

  it('includes CLAUDE.md in the workspace files table as an @AGENTS.md import', () => {
    const ctx = dummyContext();
    const content = buildWorkspaceIndex(ctx);

    expect(content).toContain('| `CLAUDE.md` | A one-line `@AGENTS.md` import, plus anything Claude-specific |');
    expect(content).toContain('| `AGENTS.md` | The context your assistant loads: projects, relationships, verification commands |');
  });

  it('lists repositories when present', () => {
    const ctx = dummyContext([
      { name: 'repo-alpha', path: '/code/repo-alpha' },
      { name: 'repo-beta', path: '/code/repo-beta' },
    ]);
    const content = buildWorkspaceIndex(ctx);

    expect(content).toContain('- `repo-alpha` — /code/repo-alpha');
    expect(content).toContain('- `repo-beta` — /code/repo-beta');
  });

  it('displays _None._ when no repositories are in workspace', () => {
    const ctx = dummyContext([]);
    const content = buildWorkspaceIndex(ctx);

    expect(content).toContain('## Repositories\n\n_None._');
  });
});
