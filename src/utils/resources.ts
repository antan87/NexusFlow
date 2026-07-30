/**
 * @module utils/resources
 * Locates files under `resources/`, which sit outside the compiled output.
 *
 * `tsc` emits only JS, so `resources/` is copied into `dist/` by
 * `scripts/copy-resources.mjs` at build time. That means the directory's position
 * relative to a module differs depending on how the code is running: from
 * `dist/utils` it is one level up, but from `src/utils` under vitest it is two.
 * Resolving a single hard-coded relative path therefore works in one context and
 * silently finds nothing in the other — and because the loaders treat a missing
 * directory as "no resources", the failure is invisible.
 *
 * So candidates are tried in order and the first that exists wins.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Resolves a path under `resources/`, or null when it cannot be found.
 *
 * @param moduleDir - The calling module's directory (`path.dirname(fileURLToPath(import.meta.url))`).
 * @param segments - Path segments below `resources/`, e.g. `'graphs'`.
 */
export async function resolveResourcePath(
  moduleDir: string,
  ...segments: string[]
): Promise<string | null> {
  for (const candidate of resourcePathCandidates(moduleDir, ...segments)) {
    try {
      await fs.stat(candidate);
      return candidate;
    } catch {
      // Try the next layout.
    }
  }
  return null;
}

/**
 * The paths {@link resolveResourcePath} will try, in order. Exported so a caller
 * that needs a path whether or not it exists yet (a writer, say) can pick the
 * first, and so tests can assert the layouts covered.
 */
export function resourcePathCandidates(moduleDir: string, ...segments: string[]): string[] {
  return [
    // Built output: dist/<subdir>/... -> dist/resources/...
    path.resolve(moduleDir, '..', '..', 'resources', ...segments),
    // Source tree under vitest: src/<a>/<b>/... -> <repo>/resources/...
    path.resolve(moduleDir, '..', '..', '..', 'resources', ...segments),
    // Modules one level down, e.g. src/utils -> <repo>/resources/...
    path.resolve(moduleDir, '..', 'resources', ...segments),
  ];
}
