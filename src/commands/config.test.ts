import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../core/config.js', () => ({ loadConfig: vi.fn(), saveConfig: vi.fn() }));
import { loadConfig, saveConfig } from '../core/config.js';
import { configSetCommand } from './config.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'config-set-'));
  await fs.mkdir(path.join(root, 'dev'));
  await fs.mkdir(path.join(root, 'ws'));
  vi.mocked(loadConfig).mockResolvedValue({ devDir: path.join(root, 'dev'), workspacesDir: path.join(root, 'ws'), scanDepth: 2 } as never);
  vi.mocked(saveConfig).mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('config set for folders', () => {
  it('saves a usable folder as a normalized absolute path', async () => {
    await fs.mkdir(path.join(root, 'code'));
    await configSetCommand('devDir', `${path.join(root, 'code')}${path.sep}`);
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ devDir: path.join(root, 'code') }));
  });

  it('refuses a missing, shared or relative folder with the setup message and saves nothing', async () => {
    await expect(configSetCommand('workspacesDir', path.join(root, 'nope'))).rejects.toThrow("workspacesDir: This folder doesn't exist. Create it first, then run this again.");
    await expect(configSetCommand('workspacesDir', path.join(root, 'dev'))).rejects.toThrow('Use a separate folder');
    await expect(configSetCommand('devDir', 'dev')).rejects.toThrow('Use a full path');
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('keeps parsing other keys as before', async () => {
    await configSetCommand('scanDepth', '3');
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ scanDepth: 3 }));
  });
});
