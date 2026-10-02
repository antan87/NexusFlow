/**
 * Playwright is already a GUI and desktop dev dependency; load it from there
 * rather than adding a third copy at the repo root.
 */
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { REPO_ROOT } from './backend.mjs';

export function loadPlaywright(pkg = 'gui') {
  const require = createRequire(path.join(REPO_ROOT, pkg, 'package.json'));
  try {
    return require('@playwright/test');
  } catch {
    throw new Error(`Playwright is not installed in ${pkg}/. Run \`npm install --prefix ${pkg}\` first.`);
  }
}
