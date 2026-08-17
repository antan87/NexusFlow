#!/usr/bin/env node
/**
 * Copies `resources/` into `dist/static-resources/` after a TypeScript build.
 *
 * `tsc` only emits compiled JS, so anything under `resources/` was previously
 * absent from `dist/` — and since package.json ships only `dist`, the built-in
 * teamwork strategies and workflow graphs were missing from every installed
 * copy. The loaders resolve these paths relative to the compiled module
 * (`dist/static-resources/...`) and swallow ENOENT, so the failure was silent.
 * The distinct name is intentional: `src/resources/` contains TypeScript code
 * and compiles to `dist/resources/`.
 */
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'resources');
const to = join(root, 'dist', 'static-resources');

// Clear the target first: `cp` overwrites but never prunes, so a resource
// deleted from source would otherwise keep shipping from a stale dist forever.
await rm(to, { recursive: true, force: true });
await mkdir(dirname(to), { recursive: true });
await cp(from, to, { recursive: true });

const groups = await readdir(to, { withFileTypes: true });
const summary = [];
for (const entry of groups) {
  if (!entry.isDirectory()) continue;
  const files = await readdir(join(to, entry.name));
  summary.push(`${entry.name}: ${files.length}`);
}

console.log(`Copied resources -> dist/static-resources (${summary.join(', ') || 'empty'})`);
