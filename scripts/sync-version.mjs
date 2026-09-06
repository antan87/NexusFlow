#!/usr/bin/env node
// Single source of truth for the ContextSpace version.
//
// The version in the root package.json is authoritative. This script propagates
// it to every other version-bearing file so all release channels (npm, VS Code
// extension, Electron desktop app) ship in lockstep.
//
//   node scripts/sync-version.mjs           # write root version into all targets
//   node scripts/sync-version.mjs --check   # verify every target matches (exit 1 on drift)
//
// The desktop installer version is handled by electron-builder, which reads it
// from desktop/package.json (already a target below).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { syncVersionContents } from './version-sync-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Files whose top-level "version" field tracks the root version. The regex
// targets the first "version" key, which is the top-level package version.
const TARGETS = [
  'extension/package.json',
  'desktop/package.json',
  'gui/package.json',
  'extension/package-lock.json',
  'desktop/package-lock.json',
  'gui/package-lock.json',
];

const VERSION_RE = /("version"\s*:\s*")([^"]*)(")/;

function readRootVersion() {
  const rootPkgPath = path.join(repoRoot, 'package.json');
  const version = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')).version;
  if (!version) {
    console.error('sync-version: root package.json has no "version" field.');
    process.exit(1);
  }
  return version;
}

function currentVersions(relPath) {
  const contents = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  const match = contents.match(VERSION_RE);
  if (!match) {
    console.error(`sync-version: no "version" field found in ${relPath}.`);
    process.exit(1);
  }
  const versions = [match[2]];
  if (relPath.endsWith('package-lock.json')) {
    const lock = JSON.parse(contents);
    const rootPackageVersion = lock.packages?.['']?.version;
    if (!rootPackageVersion) {
      console.error(`sync-version: no packages[""].version field found in ${relPath}.`);
      process.exit(1);
    }
    versions.push(rootPackageVersion);
  }
  return versions;
}

function main() {
  const isCheck = process.argv.includes('--check');
  const rootVersion = readRootVersion();

  if (isCheck) {
    const drifted = TARGETS.filter((relPath) => (
      currentVersions(relPath).some((version) => version !== rootVersion)
    ));
    if (drifted.length > 0) {
      console.error(`sync-version: version drift detected (root is ${rootVersion}):`);
      for (const relPath of drifted) {
        console.error(`  - ${relPath}: ${currentVersions(relPath).join(' / ')}`);
      }
      console.error('Run "node scripts/sync-version.mjs" to fix, or bump with "npm version".');
      process.exit(1);
    }
    console.log(`sync-version: all ${TARGETS.length} targets match root version ${rootVersion}. ✓`);
    return;
  }

  let changed = 0;
  for (const relPath of TARGETS) {
    const filePath = path.join(repoRoot, relPath);
    const before = fs.readFileSync(filePath, 'utf8');
    const after = syncVersionContents(before, relPath, rootVersion);
    if (after !== before) {
      fs.writeFileSync(filePath, after);
      console.log(`sync-version: ${relPath} -> ${rootVersion}`);
      changed++;
    }
  }
  console.log(
    changed === 0
      ? `sync-version: already in sync at ${rootVersion}.`
      : `sync-version: updated ${changed} file(s) to ${rootVersion}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
