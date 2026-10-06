import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execa } from 'execa';
import fse from 'fs-extra';
import { generateContextFiles } from './index.js';
import type { WorkspaceContext } from '../types.js';

describe('generateContextFiles with Pi harness', () => {
  let tempDir: string;
  let tempWorkspace: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-pi-test-'));
    tempWorkspace = path.join(tempDir, 'workspace');
    await fs.mkdir(tempWorkspace, { recursive: true });

    await execa('git', ['init'], { cwd: tempWorkspace });
    await execa('git', ['config', 'user.name', 'Test Runner'], { cwd: tempWorkspace });
    await execa('git', ['config', 'user.email', 'test@local'], { cwd: tempWorkspace });
  });

  afterEach(async () => {
    await fse.remove(tempDir);
  });

  it('generates context files for pi without throwing TypeError', async () => {
    const ctx: WorkspaceContext = {
      feature: {
        id: 'pi-session-feature',
        branchName: 'feat/pi-session',
        description: 'Testing workspace creation with Pi assistant',
        repos: [],
        assistants: ['pi'],
        workspacePath: tempWorkspace,
        createdAt: new Date().toISOString(),
      },
      repos: [],
    };

    await fs.writeFile(path.join(tempWorkspace, 'contextspace.json'), JSON.stringify(ctx.feature));

    await expect(generateContextFiles(ctx, ['pi'], tempWorkspace)).resolves.not.toThrow();

    const agentsMd = await fs.readFile(path.join(tempWorkspace, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('Testing workspace creation with Pi assistant');

    const workspaceMd = await fs.readFile(path.join(tempWorkspace, 'WORKSPACE.md'), 'utf-8');
    expect(workspaceMd).toContain('Testing workspace creation with Pi assistant');

    const knowledgeMd = await fs.readFile(path.join(tempWorkspace, 'contextspace-knowledge.md'), 'utf-8');
    expect(knowledgeMd).toContain('Testing workspace creation with Pi assistant');
  });

  it('supports combining pi with other assistants like claude', async () => {
    const ctx: WorkspaceContext = {
      feature: {
        id: 'multi-assistant-feature',
        branchName: 'feat/multi',
        description: 'Multi-assistant feature with Claude and Pi',
        repos: [],
        assistants: ['claude', 'pi'],
        workspacePath: tempWorkspace,
        createdAt: new Date().toISOString(),
      },
      repos: [],
    };

    await fs.writeFile(path.join(tempWorkspace, 'contextspace.json'), JSON.stringify(ctx.feature));

    await expect(generateContextFiles(ctx, ['claude', 'pi'], tempWorkspace)).resolves.not.toThrow();

    expect(await fse.pathExists(path.join(tempWorkspace, 'CLAUDE.md'))).toBe(true);
    expect(await fse.pathExists(path.join(tempWorkspace, 'AGENTS.md'))).toBe(true);
  });
});
