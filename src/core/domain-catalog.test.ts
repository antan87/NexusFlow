import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readDomainCatalog } from './domain-catalog.js';
import { saveDomainPack, saveOrganization, deleteDomainPack, deleteOrganization, getDomainPack, getOrganization } from './domain-packs.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

describe('durable domain catalog', () => {
  let home: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'domain-catalog-'));
    vi.stubEnv('CONTEXTSPACE_HOME', home);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(home, { recursive: true, force: true });
  });

  it('reloads definitions after module restart and persists updates and deletion', async () => {
    await saveDomainPack({ id: 'CUSTOM', name: 'Custom', description: 'Rules', tags: ['custom'] });
    await saveOrganization({ id: 'CORP', name: 'Corp', rules: ['Keep changes focused'] });
    vi.resetModules();
    const restarted = await import('./domain-packs.js');
    expect(restarted.getDomainPack('custom')?.name).toBe('Custom');
    expect(restarted.getOrganization('corp')?.rules).toEqual(['Keep changes focused']);
    await restarted.saveDomainPack({ id: 'custom', name: 'Updated', description: '', tags: [] });
    expect(getDomainPack('custom')?.name).toBe('Updated');
    await deleteDomainPack('custom');
    await deleteOrganization('corp');
    expect(restarted.getDomainPack('custom')).toBeNull();
    expect(getOrganization('corp')).toBeNull();
  });

  it('preserves independent concurrent writes and isolates configured homes', async () => {
    vi.resetModules();
    const independent = await import('./domain-packs.js');
    await Promise.all([
      saveDomainPack({ id: 'a', name: 'A', description: '', tags: [] }),
      independent.saveDomainPack({ id: 'b', name: 'B', description: '', tags: [] }),
    ]);
    expect(readDomainCatalog().domainPacks.map((p) => p.id).sort()).toEqual(['a', 'b']);
    vi.stubEnv('CONTEXTSPACE_HOME', path.join(home, 'other'));
    expect(readDomainCatalog().domainPacks).toEqual([]);
  });

  it('does not overwrite a corrupt catalog on mutation', async () => {
    const file = path.join(home, 'domain-catalog.json');
    await fs.writeFile(file, 'corrupt');
    await expect(saveOrganization({ id: 'corp', name: 'Corp', rules: [] })).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe('corrupt');
  });

  it('preserves the previous catalog after a failed atomic write and releases its lock', async () => {
    await saveOrganization({ id: 'corp', name: 'Original', rules: [] });
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Disk failure'));
    try {
      await expect(saveOrganization({ id: 'corp', name: 'Lost update', rules: [] })).rejects.toThrow('Disk failure');
    } finally {
      rename.mockRestore();
    }
    expect(getOrganization('corp')?.name).toBe('Original');
    await saveOrganization({ id: 'corp', name: 'Recovered', rules: [] });
    expect(getOrganization('corp')?.name).toBe('Recovered');
  });

  it('rejects linked catalogs without modifying their target', async () => {
    const outside = path.join(home, 'outside.json');
    await fs.writeFile(outside, '{"organizations":[],"domainPacks":[]}');
    await fs.symlink(outside, path.join(home, 'domain-catalog.json'));
    await expect(saveOrganization({ id: 'corp', name: 'Corp', rules: [] })).rejects.toThrow(/Linked/);
    expect(JSON.parse(await fs.readFile(outside, 'utf8')).organizations).toEqual([]);
  });
});
