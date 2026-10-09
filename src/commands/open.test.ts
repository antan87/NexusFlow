import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openCommand } from './open.js';
import * as config from '../core/config.js';
import * as workspace from '../core/workspace.js';
import * as detectEditorsModule from '../utils/detect-editors.js';
import * as promptsModule from '../utils/prompts.js';
import * as sessionFinder from '../utils/session-finder.js';
import * as inquirerPrompts from '@inquirer/prompts';
import { execa } from 'execa';

vi.mock('execa');
vi.mock('../core/config.js');
vi.mock('../core/workspace.js');
vi.mock('../utils/detect-editors.js');
vi.mock('../utils/open-editor.js');
vi.mock('../utils/prompts.js');
vi.mock('../utils/session-finder.js');
vi.mock('@inquirer/prompts');

describe('openCommand with Pi assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resumes a pi session with --session <id>', async () => {
    vi.mocked(config.loadConfig).mockResolvedValue({
      version: '1.0.0',
      devDir: '/mock/dev',
      workspacesDir: '/mock/workspaces',
      defaultAssistant: 'pi',
      scanDepth: 2,
    });

    const mockWorkspace = {
      id: 'ws-1',
      branchName: 'feat/pi-test',
      description: 'Pi workspace',
      repos: ['/mock/workspaces/ws-1/repo'],
      assistants: ['pi' as const],
      workspacePath: '/mock/workspaces/ws-1',
      createdAt: new Date().toISOString(),
    };

    vi.mocked(workspace.listWorkspaces).mockResolvedValue([mockWorkspace]);
    vi.mocked(inquirerPrompts.search).mockResolvedValue('/mock/workspaces/ws-1');
    vi.mocked(detectEditorsModule.detectEditors).mockResolvedValue([]);
    vi.mocked(promptsModule.promptSelectEditor).mockResolvedValue(null);
    vi.mocked(inquirerPrompts.confirm).mockResolvedValue(true);
    vi.mocked(sessionFinder.findSessions).mockResolvedValue([
      {
        id: 'pi-session-1234',
        assistant: 'pi',
        title: 'Fix pi harness',
        workspacePath: '/mock/workspaces/ws-1',
        recordedCwd: '/mock/workspaces/ws-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 3,
      },
    ]);
    vi.mocked(inquirerPrompts.select).mockResolvedValue('pi-session-1234');
    vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

    await openCommand();

    expect(execa).toHaveBeenCalledWith('pi', ['--session', 'pi-session-1234'], {
      cwd: '/mock/workspaces/ws-1',
      stdio: 'inherit',
      shell: process.platform === 'win32',
      reject: false,
    });
  });

  it('starts a new pi session without args if user selects __new__', async () => {
    vi.mocked(config.loadConfig).mockResolvedValue({
      version: '1.0.0',
      devDir: '/mock/dev',
      workspacesDir: '/mock/workspaces',
      defaultAssistant: 'pi',
      scanDepth: 2,
    });

    const mockWorkspace = {
      id: 'ws-1',
      branchName: 'feat/pi-test',
      description: 'Pi workspace',
      repos: ['/mock/workspaces/ws-1/repo'],
      assistants: ['pi' as const],
      workspacePath: '/mock/workspaces/ws-1',
      createdAt: new Date().toISOString(),
    };

    vi.mocked(workspace.listWorkspaces).mockResolvedValue([mockWorkspace]);
    vi.mocked(inquirerPrompts.search).mockResolvedValue('/mock/workspaces/ws-1');
    vi.mocked(detectEditorsModule.detectEditors).mockResolvedValue([]);
    vi.mocked(promptsModule.promptSelectEditor).mockResolvedValue(null);
    vi.mocked(inquirerPrompts.confirm).mockResolvedValue(true);
    vi.mocked(sessionFinder.findSessions).mockResolvedValue([
      {
        id: 'pi-session-1234',
        assistant: 'pi',
        title: 'Fix pi harness',
        workspacePath: '/mock/workspaces/ws-1',
        recordedCwd: '/mock/workspaces/ws-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 3,
      },
    ]);
    vi.mocked(inquirerPrompts.select).mockResolvedValue('__new__');
    vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

    await openCommand();

    expect(execa).toHaveBeenCalledWith('pi', [], {
      cwd: '/mock/workspaces/ws-1',
      stdio: 'inherit',
      shell: process.platform === 'win32',
      reject: false,
    });
  });
});
