import { describe, expect, it } from 'vitest';

import { syncVersionContents } from './version-sync-core.mjs';

describe('syncVersionContents', () => {
  it('updates both project version fields in a package lock', () => {
    const staleLock = JSON.stringify({
      name: 'nested-package',
      version: '2.1.1',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'nested-package',
          version: '2.0.0',
        },
      },
    }, null, 2) + '\n';

    const updated = syncVersionContents(staleLock, 'nested/package-lock.json', '2.2.0');
    const parsed = JSON.parse(updated);

    expect(parsed.version).toBe('2.2.0');
    expect(parsed.packages[''].version).toBe('2.2.0');
    expect(updated.endsWith('\n')).toBe(true);
  });

  it('updates only the top-level manifest version', () => {
    const manifest = '{\n  "name": "nested-package",\n  "version": "2.1.1"\n}\n';

    expect(syncVersionContents(manifest, 'nested/package.json', '2.2.0'))
      .toContain('"version": "2.2.0"');
  });
});
