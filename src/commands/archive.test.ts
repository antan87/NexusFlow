import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm } from '@inquirer/prompts';

import { archiveCommand, unarchiveCommand } from './archive.js';
import { listCommand } from './list.js';
import * as archive from '../core/archive.js';
import * as config from '../core/config.js';
import * as workspace from '../core/workspace.js';
import * as resolveWs from '../utils/resolve-workspace.js';
import type { ArchiveReport } from '../core/archive.js';
import type { Feature } from '../types.js';

vi.mock('../core/archive.js');
vi.mock('../core/config.js');
vi.mock('../core/workspace.js');
vi.mock('../utils/resolve-workspace.js');
vi.mock('@inquirer/prompts');

function report(overrides: Partial<ArchiveReport> = {}): ArchiveReport {
  return {
    workspacePath: '/ws', workspaceId: 'ws', dryRun: false, alreadyArchived: false, ready: true,
    blockers: [], repos: [], kept: ['contextspace.json'], notes: [], archived: false, errors: [],
    ...overrides,
  };
}

function feature(id: string, archivedAt?: string): Feature {
  return {
    id, branchName: id, description: '', repos: ['/r'], assistants: [], workspacePath: `/w/${id}`,
    createdAt: '2026-09-01T00:00:00.000Z', ...(archivedAt ? { archivedAt } : {}),
  };
}

describe('archive commands', () => {
  let out: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { out.push(args.join(' ')); });
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('--json prints only the report and exits nonzero when blocked', async () => {
    vi.mocked(resolveWs.resolveWorkspaceQuiet).mockResolvedValue('/ws');
    vi.mocked(archive.archiveWorkspace).mockResolvedValue(report({ ready: false, blockers: ['api: dirty'] }));

    await archiveCommand('ws', { json: true, park: true });

    expect(archive.archiveWorkspace).toHaveBeenCalledWith('/ws', { park: true, dryRun: undefined });
    expect(JSON.parse(out.join('\n'))).toMatchObject({ ready: false, blockers: ['api: dirty'] });
    expect(process.exitCode).toBe(1);
  });

  it('a blocked plan is reported without asking and without archiving', async () => {
    vi.mocked(resolveWs.resolveWorkspaceInteractive).mockResolvedValue('/ws');
    vi.mocked(archive.planArchive).mockResolvedValue(report({ ready: false, blockers: ['api: 1 uncommitted file(s).'] }));

    await archiveCommand('ws');

    expect(confirm).not.toHaveBeenCalled();
    expect(archive.archiveWorkspace).not.toHaveBeenCalled();
    expect(out.join('\n')).toMatch(/Archive refused; nothing was removed/);
    expect(process.exitCode).toBe(1);
  });

  it('archives after confirmation', async () => {
    vi.mocked(resolveWs.resolveWorkspaceInteractive).mockResolvedValue('/ws');
    vi.mocked(archive.planArchive).mockResolvedValue(report());
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(archive.archiveWorkspace).mockResolvedValue(report({ archived: true, archivedAt: 'now' }));

    await archiveCommand('ws');

    expect(archive.archiveWorkspace).toHaveBeenCalledWith('/ws', { park: undefined });
    expect(out.join('\n')).toMatch(/Archived "ws"/);
    expect(process.exitCode).toBeUndefined();
  });

  it('unarchive picks only among archived workspaces', async () => {
    vi.mocked(resolveWs.resolveWorkspaceInteractive).mockResolvedValue('/ws');
    vi.mocked(archive.unarchiveWorkspace).mockResolvedValue({ workspacePath: '/ws', workspaceId: 'ws', restored: true, notes: [] });

    await unarchiveCommand(undefined);

    expect(resolveWs.resolveWorkspaceInteractive).toHaveBeenCalledWith(undefined, expect.any(String), { archived: 'only' });
    expect(out.join('\n')).toMatch(/Restored "ws"/);
  });

  it('list hides archived workspaces unless asked for them', async () => {
    vi.mocked(config.loadConfig).mockResolvedValue({ workspacesDir: '/w' } as any);
    vi.mocked(workspace.listWorkspaces).mockResolvedValue([feature('active'), feature('old', '2026-09-28T00:00:00.000Z')]);

    await listCommand({ json: true });
    expect((JSON.parse(out.join('\n')) as Feature[]).map((w) => w.id)).toEqual(['active']);

    out = [];
    await listCommand({ json: true, archived: true });
    expect((JSON.parse(out.join('\n')) as Feature[]).map((w) => w.id)).toEqual(['old']);

    out = [];
    await listCommand({ json: true, all: true });
    expect((JSON.parse(out.join('\n')) as Feature[]).map((w) => w.id)).toEqual(['active', 'old']);

    out = [];
    await listCommand({});
    expect(out.join('\n')).toMatch(/1 archived workspace\(s\) hidden/);
  });
});
