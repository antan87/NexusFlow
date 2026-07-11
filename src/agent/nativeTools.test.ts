import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import fs from 'fs-extra';
import { executeNativeTool, buildSystemPrompt } from './nativeTools.js';

let workspace: string;

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-native-tools-'));
  await fs.writeFile(path.join(workspace, 'inside.txt'), 'hello', 'utf8');
  await fs.ensureDir(path.join(workspace, 'sub'));
});

afterAll(async () => {
  await fs.remove(workspace);
});

describe('executeNativeTool', () => {
  it('reads a file inside the workspace', async () => {
    const out = await executeNativeTool(workspace, 'read_file', { filePath: 'inside.txt' });
    expect(out).toBe('hello');
  });

  it('lists a directory inside the workspace with real newlines', async () => {
    const out = await executeNativeTool(workspace, 'list_directory', { dirPath: '.' });
    expect(out.split('\n').sort()).toEqual(['inside.txt', 'sub']);
  });

  it('rejects a relative path that escapes the workspace', async () => {
    await expect(executeNativeTool(workspace, 'read_file', { filePath: '../../../etc/hosts' }))
      .rejects.toThrow(/escapes the workspace/);
  });

  it('rejects an absolute path outside the workspace', async () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/hosts';
    await expect(executeNativeTool(workspace, 'read_file', { filePath: outside }))
      .rejects.toThrow(/escapes the workspace/);
  });

  it('rejects an unknown tool', async () => {
    await expect(executeNativeTool(workspace, 'delete_everything', {}))
      .rejects.toThrow(/Unknown tool/);
  });

  it('rejects a symlink inside the workspace that points outside it', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-outside-'));
    const secret = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(secret, 'top secret', 'utf8');
    const link = path.join(workspace, 'escape.txt');
    try {
      await fs.symlink(secret, link);
    } catch {
      // Symlink creation needs privileges on Windows; skip if unavailable.
      await fs.remove(outsideDir);
      return;
    }
    try {
      await expect(executeNativeTool(workspace, 'read_file', { filePath: 'escape.txt' }))
        .rejects.toThrow(/escapes the workspace/);
    } finally {
      await fs.remove(link);
      await fs.remove(outsideDir);
    }
  });
});

describe('buildSystemPrompt', () => {
  it('states the workspace path and read-only scope', () => {
    const p = buildSystemPrompt('/tmp/ws');
    expect(p).toContain('/tmp/ws');
    expect(p).toContain('read-only');
  });
});
