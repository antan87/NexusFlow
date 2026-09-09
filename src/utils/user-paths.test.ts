import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findExecutable,
  getAugmentedPath,
  getUserCandidatePaths,
} from './user-paths.js';

let tmpDir = '';

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextspace-userpaths-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('getUserCandidatePaths', () => {
  it('returns linux candidate paths', () => {
    const paths = getUserCandidatePaths('linux', {}, tmpDir);
    expect(paths).toContain('/usr/local/bin');
    expect(paths).toContain(path.join(tmpDir, '.local', 'bin'));
    expect(paths).toContain(path.join(tmpDir, '.cargo', 'bin'));
  });

  it('returns darwin candidate paths', () => {
    const paths = getUserCandidatePaths('darwin', {}, tmpDir);
    expect(paths).toContain('/opt/homebrew/bin');
    expect(paths).toContain('/usr/local/bin');
    expect(paths).toContain(path.join(tmpDir, '.local', 'bin'));
  });

  it('returns windows candidate paths when environment variables are set', () => {
    const env = {
      APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    };
    const paths = getUserCandidatePaths('win32', env, 'C:\\Users\\test');
    expect(paths).toContain('C:\\Users\\test\\AppData\\Roaming\\npm');
    expect(paths).toContain('C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps');
  });

  it('scans nvm versions when directory exists', async () => {
    const nvmVersionsDir = path.join(tmpDir, '.nvm', 'versions', 'node');
    const v20 = path.join(nvmVersionsDir, 'v20.0.0', 'bin');
    const v22 = path.join(nvmVersionsDir, 'v22.0.0', 'bin');
    await fs.mkdir(v20, { recursive: true });
    await fs.mkdir(v22, { recursive: true });

    const paths = getUserCandidatePaths('linux', {}, tmpDir);
    expect(paths).toContain(v22);
    expect(paths).toContain(v20);
  });
});

describe('getAugmentedPath', () => {
  it('appends existing candidate directories to PATH without duplicates', async () => {
    const localBin = path.join(tmpDir, '.local', 'bin');
    await fs.mkdir(localBin, { recursive: true });

    const existingPath = '/bin:/usr/bin';
    const augmented = getAugmentedPath({ PATH: existingPath }, 'linux', tmpDir);
    expect(augmented.startsWith(existingPath)).toBe(true);
    expect(augmented).toContain(localBin);
  });

  it('does not duplicate directories already in PATH', async () => {
    const localBin = path.join(tmpDir, '.local', 'bin');
    await fs.mkdir(localBin, { recursive: true });

    const existingPath = `/bin:${localBin}:/usr/bin`;
    const augmented = getAugmentedPath({ PATH: existingPath }, 'linux', tmpDir);
    const count = augmented.split(':').filter((p) => p === localBin).length;
    expect(count).toBe(1);
  });
});

describe('findExecutable', () => {
  it('finds an executable file on PATH', async () => {
    const isWin = process.platform === 'win32';
    const filename = isWin ? 'test-cli.cmd' : 'test-cli';
    const targetFile = path.join(tmpDir, filename);
    await fs.writeFile(targetFile, '#!/bin/sh\necho ok', { mode: 0o755 });
    try { await fs.chmod(targetFile, 0o755); } catch {}

    const result = findExecutable('test-cli', { PATH: tmpDir, PATHEXT: '.CMD' });
    expect(result).toBe(targetFile);
  });

  it('returns null if executable is not found', () => {
    expect(findExecutable('nonexistent-binary', { PATH: tmpDir })).toBeNull();
  });

  it('returns null if PATH is empty', () => {
    expect(findExecutable('test-cli', {})).toBeNull();
  });
});
