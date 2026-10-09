import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * macOS and Windows ignore case in file names, so an import of `./SessionDeck.js` can open `sessionDeck.ts` there and
 * the build breaks, while Linux builds it fine. Every module name must differ from its neighbours by more than case.
 */
function caseClashes(root: string): string[][] {
  const groups = new Map<string, string[]>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      const key = relative(root, path).replace(/\.[cm]?[jt]sx?$/, '').toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), relative(root, path)]);
    }
  };
  walk(root);
  return [...groups.values()].filter((names) => names.length > 1);
}

describe('file names', () => {
  it.each([['gui/src', '.'], ['backend src', '../../src']])('in %s differ by more than case', (_name, folder) => {
    expect(caseClashes(fileURLToPath(new URL(folder, import.meta.url)))).toEqual([]);
  });
});
