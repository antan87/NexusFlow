import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { isLegacyWorkspace, migrateWorkspace, migrateGlobalConfig } from './migrate.js';
import { BRAND_CONFIG } from './brand-config.js';

describe('core/migrate', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-migrate-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('detects legacy workspace when nexusflow.json is present', async () => {
    await fs.writeFile(path.join(tempDir, 'nexusflow.json'), JSON.stringify({ id: 'test-feat' }));
    expect(await isLegacyWorkspace(tempDir)).toBe(true);
  });

  it('returns false when only contextspace.json is present', async () => {
    await fs.writeFile(path.join(tempDir, 'contextspace.json'), JSON.stringify({ id: 'test-feat' }));
    expect(await isLegacyWorkspace(tempDir)).toBe(false);
  });

  it('migrates legacy files to ContextSpace names in dry-run mode without disk modification', async () => {
    await fs.writeFile(path.join(tempDir, 'nexusflow.json'), JSON.stringify({ id: 'test-feat' }));
    await fs.writeFile(path.join(tempDir, 'nexusflow-knowledge.md'), '# Knowledge\n');

    const report = await migrateWorkspace(tempDir, { dryRun: true, refresh: false });
    expect(report.isLegacy).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.renamedFiles.length).toBeGreaterThan(0);

    // Files on disk should NOT be changed in dry run
    expect(await fs.access(path.join(tempDir, 'nexusflow.json')).then(() => true).catch(() => false)).toBe(true);
    expect(await fs.access(path.join(tempDir, 'contextspace.json')).then(() => true).catch(() => false)).toBe(false);
  });

  it('migrates legacy files and updates markdown sentinels on disk', async () => {
    await fs.writeFile(path.join(tempDir, 'nexusflow.json'), JSON.stringify({ id: 'my-feature', branchName: 'my-feature' }));
    await fs.writeFile(
      path.join(tempDir, 'nexusflow-knowledge.md'),
      '<!-- NEXUSFLOW:FRESHNESS:START -->\n> nexusflow refresh\n<!-- NEXUSFLOW:FRESHNESS:END -->\n### Gotcha\n',
    );
    await fs.writeFile(path.join(tempDir, 'nexusflow-plan.md'), '# Plan\n');
    await fs.mkdir(path.join(tempDir, '.nexusflow'), { recursive: true });
    await fs.writeFile(path.join(tempDir, '.nexusflow', 'resources.json'), '{}');

    const report = await migrateWorkspace(tempDir, { dryRun: false, refresh: false });
    expect(report.isLegacy).toBe(true);

    // Primary files should now exist
    expect(await fs.access(path.join(tempDir, 'contextspace.json')).then(() => true).catch(() => false)).toBe(true);
    expect(await fs.access(path.join(tempDir, 'contextspace-knowledge.md')).then(() => true).catch(() => false)).toBe(true);
    expect(await fs.access(path.join(tempDir, 'contextspace-plan.md')).then(() => true).catch(() => false)).toBe(true);
    expect(await fs.access(path.join(tempDir, '.contextspace', 'resources.json')).then(() => true).catch(() => false)).toBe(true);

    // Sentinels in knowledge file should be updated
    const migratedKnowledge = await fs.readFile(path.join(tempDir, 'contextspace-knowledge.md'), 'utf-8');
    expect(migratedKnowledge).toContain('CONTEXTSPACE:FRESHNESS:START');
    expect(migratedKnowledge).toContain('ctxspace refresh');
  });

  it('is idempotent when run multiple times', async () => {
    await fs.writeFile(path.join(tempDir, 'nexusflow.json'), JSON.stringify({ id: 'feat' }));
    await migrateWorkspace(tempDir, { dryRun: false, refresh: false });

    // Second run
    const secondReport = await migrateWorkspace(tempDir, { dryRun: false, refresh: false });
    expect(secondReport.isLegacy).toBe(false);
    expect(secondReport.renamedFiles.length).toBe(0);
  });
});
