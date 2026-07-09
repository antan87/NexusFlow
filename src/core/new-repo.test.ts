import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createNewRepo, isValidProjectName } from './new-repo.js';

/** These tests drive real git; skip cleanly where git is unavailable. */
const hasGit = (() => {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('isValidProjectName', () => {
  it('accepts plain directory names', () => {
    expect(isValidProjectName('my-project')).toBe(true);
    expect(isValidProjectName('MyProject2')).toBe(true);
    expect(isValidProjectName('my_project.api')).toBe(true);
  });

  it('rejects empty, dot, and over-long names', () => {
    expect(isValidProjectName('')).toBe(false);
    expect(isValidProjectName('.')).toBe(false);
    expect(isValidProjectName('..')).toBe(false);
    expect(isValidProjectName('x'.repeat(101))).toBe(false);
  });

  it('rejects path separators and reserved characters', () => {
    expect(isValidProjectName('a/b')).toBe(false);
    expect(isValidProjectName('a\\b')).toBe(false);
    expect(isValidProjectName('a:b')).toBe(false);
    expect(isValidProjectName('a*b')).toBe(false);
    expect(isValidProjectName('a?b')).toBe(false);
  });

  it('rejects leading/trailing dots and spaces', () => {
    expect(isValidProjectName('.hidden')).toBe(false);
    expect(isValidProjectName('name.')).toBe(false);
    expect(isValidProjectName(' name')).toBe(false);
    expect(isValidProjectName('name ')).toBe(false);
  });
});

describe.skipIf(!hasGit)('createNewRepo (real git)', () => {
  let devDir = '';
  let counter = 0;

  beforeEach(async () => {
    counter += 1;
    devDir = path.join(os.tmpdir(), `nexusflow-newrepo-test-${process.pid}-${counter}`);
    await fs.mkdir(devDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(devDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  });

  it('scaffolds a repo on main with an initial commit and README', async () => {
    const repo = await createNewRepo(devDir, 'my-service');

    expect(repo).toEqual({
      name: 'my-service',
      path: path.join(devDir, 'my-service'),
      defaultBranch: 'main',
    });

    const { stdout: branch } = await execa('git', ['branch', '--show-current'], { cwd: repo.path });
    expect(branch.trim()).toBe('main');
    const { stdout: log } = await execa('git', ['log', '--oneline'], { cwd: repo.path });
    expect(log).toContain('Initial commit');
    const readme = await fs.readFile(path.join(repo.path, 'README.md'), 'utf8');
    expect(readme).toBe('# my-service\n');
  });

  it('refuses to adopt an existing directory', async () => {
    await fs.mkdir(path.join(devDir, 'taken'), { recursive: true });

    await expect(createNewRepo(devDir, 'taken')).rejects.toThrow(/already exists/);
  });

  it('rejects invalid names without touching the filesystem', async () => {
    await expect(createNewRepo(devDir, '../escape')).rejects.toThrow(/Invalid project name/);
    await expect(fs.access(path.join(devDir, '..', 'escape'))).rejects.toBeTruthy();
  });
});
