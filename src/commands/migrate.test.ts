import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { migrateCommand } from './migrate.js';

describe('commands/migrate', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-migrate-cmd-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs cleanly on non-legacy workspace', async () => {
    await fs.writeFile(path.join(tempDir, 'contextspace.json'), JSON.stringify({ id: 'clean' }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await migrateCommand(tempDir, { dryRun: false, refresh: false });
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('migrates a legacy workspace via command', async () => {
    await fs.writeFile(path.join(tempDir, 'nexusflow.json'), JSON.stringify({ id: 'legacy' }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await migrateCommand(tempDir, { dryRun: false, refresh: false });
    expect(await fs.access(path.join(tempDir, 'contextspace.json')).then(() => true).catch(() => false)).toBe(true);
    logSpy.mockRestore();
  });
});
