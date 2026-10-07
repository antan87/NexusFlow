import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TerminalWorkspace } from './TerminalWorkspace.js';
import { isPathInsideWorkspace, isWebOrDomain, normalizeWebUrl } from './webLinks.js';
import { resolveFileReference } from '../changes/resolveFileReference.js';

describe('TerminalWorkspace link routing guards and inspector control', () => {
  const workspacePath = '/home/user/workspace';
  const repoPaths = ['/home/user/workspace/nexusflow', '/home/user/workspace/other-repo'];
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  it('renders TerminalWorkspace with toggle button and initial closed inspector state', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(TerminalWorkspace, {
          workspace: 'test-ws',
          workspacePath,
          repoPaths,
          active: true,
          consumeLaunch: () => {},
        })
      )
    );

    // Initial state: Code button exists in toolbar, not pressed
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Toggle the code panel');
    expect(html).toContain('Code');
  });

  it('identifies and guards against web schemes, wrapped URLs, and domains', () => {
    const webUrls = [
      'https://github.com/mrpatronz/nexusflow',
      'http://localhost:3000/api',
      '<https://example.com/docs>',
      '<http://127.0.0.1:8080>',
      'mailto:team@example.com',
      '<mailto:user@example.com>',
      'github.com/foo/bar',
      'example.com:8080',
      'localhost:3000',
      '127.0.0.1:3000/test',
      'www.google.com',
    ];

    for (const url of webUrls) {
      const clean = url.replace(/^<+|>+$/g, '').trim();
      expect(isWebOrDomain(clean)).toBe(true);
      const normalized = normalizeWebUrl(clean);
      expect(normalized).toMatch(/^(?:https?:\/\/|mailto:)/);
    }
  });

  it('guards against external paths outside the workspace and repositories', () => {
    expect(isPathInsideWorkspace('/etc/passwd', workspacePath, repoPaths)).toBe(false);
    expect(isPathInsideWorkspace('file:///etc/passwd', workspacePath, repoPaths)).toBe(false);
    expect(isPathInsideWorkspace('/tmp/scratch.log', workspacePath, repoPaths)).toBe(false);
    expect(isPathInsideWorkspace('/home/otheruser/project/file.ts', workspacePath, repoPaths)).toBe(false);
    expect(isPathInsideWorkspace('../../escape.txt', workspacePath, repoPaths)).toBe(false);

    // Valid paths inside workspace or repos
    expect(isPathInsideWorkspace('/home/user/workspace/nexusflow/src/index.ts', workspacePath, repoPaths)).toBe(true);
    expect(isPathInsideWorkspace('file:///home/user/workspace/nexusflow/src/index.ts', workspacePath, repoPaths)).toBe(true);
    expect(isPathInsideWorkspace('/home/user/workspace/other-repo/README.md', workspacePath, repoPaths)).toBe(true);
    expect(isPathInsideWorkspace('src/index.ts', workspacePath, repoPaths)).toBe(true);
    expect(isPathInsideWorkspace('./README.md', workspacePath, repoPaths)).toBe(true);
  });

  it('guards against unresolvable paths within repos and resolves valid worktree files', () => {
    const repos = [
      {
        repoName: 'nexusflow',
        repoPath: '/home/user/workspace/nexusflow',
        files: [
          { file: 'src/index.ts' },
          { file: 'package.json' },
        ],
      },
      {
        repoName: 'other-repo',
        repoPath: '/home/user/workspace/other-repo',
        files: [
          { file: 'README.md' },
        ],
      },
    ];

    // Valid file in nexusflow repo
    const valid = resolveFileReference('src/index.ts', repos);
    expect(valid.file).toBeDefined();
    expect(valid.file?.file).toBe('src/index.ts');
    expect(valid.file?.repoName).toBe('nexusflow');

    // Valid file with angle brackets and file:// scheme
    const validWrapped = resolveFileReference('<src/index.ts>', repos);
    expect(validWrapped.file?.file).toBe('src/index.ts');
    const validFileUri = resolveFileReference('file:///home/user/workspace/nexusflow/src/index.ts', repos);
    expect(validFileUri.file?.file).toBe('src/index.ts');

    // Valid file with GitHub line anchor and section anchor
    const validAnchor = resolveFileReference('src/index.ts#L42', repos);
    expect(validAnchor.file?.file).toBe('src/index.ts');
    const validRangeAnchor = resolveFileReference('src/index.ts#L10-L20', repos);
    expect(validRangeAnchor.file?.file).toBe('src/index.ts');
    const validSectionAnchor = resolveFileReference('README.md#setup-section', repos);
    expect(validSectionAnchor.file?.file).toBe('README.md');
    const validFileUriAnchor = resolveFileReference('file:///home/user/workspace/nexusflow/src/index.ts#L42', repos);
    expect(validFileUriAnchor.file?.file).toBe('src/index.ts');

    // Valid file in other-repo
    const validOther = resolveFileReference('README.md', repos);
    expect(validOther.file).toBeDefined();
    expect(validOther.file?.repoName).toBe('other-repo');

    // Unresolvable path not in any repo
    const missing = resolveFileReference('src/nonexistent.ts', repos);
    expect(missing.file).toBeUndefined();
    expect(missing.error).toContain('not in this workspace\'s file tree');
  });
});
