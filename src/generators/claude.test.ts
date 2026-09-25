import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { generateClaudeConfig } from './claude.js';
import { readWorkspaceFile } from '../core/storage.js';
import * as storage from '../core/storage.js';
import { GENERATED_VIEW_HEADER } from '../core/generation-lock.js';
import { CLI_NAME } from '../core/constants.js';
import type { WorkspaceContext } from '../types.js';

describe('generateClaudeConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-gen-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  function dummyContext(): WorkspaceContext {
    return {
      feature: {
        id: 'test-feature',
        branchName: 'feat/test',
        description: 'Testing Claude generation',
        repos: [],
        assistants: ['claude'],
        workspacePath: tempDir,
        createdAt: new Date().toISOString(),
      },
      repos: [],
    };
  }

  it('generates CLAUDE.md importing AGENTS.md', async () => {
    const ctx = dummyContext();
    await generateClaudeConfig(ctx, tempDir);

    const content = await readWorkspaceFile(tempDir, ctx.feature.id, 'CLAUDE.md');

    expect(content).toContain('@AGENTS.md');
    expect(content).toContain('## Claude Code');
    expect(content).toContain('/plan');
  });

  it('does NOT contain the outdated multiline HTML comment', async () => {
    const ctx = dummyContext();
    await generateClaudeConfig(ctx, tempDir);

    const content = await readWorkspaceFile(tempDir, ctx.feature.id, 'CLAUDE.md');

    expect(content).not.toContain('<!-- AGENTS.md holds the workspace context');
    expect(content).not.toContain('Claude Code does not read it');
  });

  it('includes the canonical generated view header and CLI knowledge command', async () => {
    const ctx = dummyContext();
    await generateClaudeConfig(ctx, tempDir);

    const content = await readWorkspaceFile(tempDir, ctx.feature.id, 'CLAUDE.md');

    expect(content.startsWith(GENERATED_VIEW_HEADER)).toBe(true);
    expect(content).toContain(`${CLI_NAME} knowledge add`);
    expect(content).toBe(`${GENERATED_VIEW_HEADER}

@AGENTS.md

## Claude Code

- Prefer \`/plan\` before a change that spans more than one repository in this workspace.
- Record durable findings with \`${CLI_NAME} knowledge add\` rather than in chat, so the next session inherits them.
`);
  });

  it('re-throws error when writing CLAUDE.md fails', async () => {
    const ctx = dummyContext();
    vi.spyOn(storage, 'writeWorkspaceFile').mockRejectedValueOnce(new Error('Disk full'));

    await expect(generateClaudeConfig(ctx, tempDir)).rejects.toThrow('Failed to write CLAUDE.md: Disk full');
  });
});
