#!/usr/bin/env node
// Single source of truth for the NexusFlow version.
//
// The version in the root package.json is authoritative. This script propagates
// it to every other version-bearing file so all release channels (npm, VS Code
// extension, desktop installer) ship in lockstep.
//
//   node scripts/sync-version.mjs           # write root version into all targets
//   node scripts/sync-version.mjs --check   # verify every target matches (exit 1 on drift)
//
// The desktop Inno Setup version is NOT handled here — it is injected at build
// time via an ISCC /DAppVersion define (see desktop/build-installer.js).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Files whose top-level "version" field tracks the root version.
// For neutralino.config.json this is the app version only — its cli.binaryVersion
// / cli.clientVersion (the Neutralino framework versions) are deliberately left
// untouched because the replace targets the FIRST "version" key, which is the
// top-level app version.
const TARGETS = [
  'extension/package.json',
  'desktop/package.json',
  'gui/package.json',
  'desktop/neutralino.config.json',
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

function currentVersion(relPath) {
  const contents = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  const match = contents.match(VERSION_RE);
  if (!match) {
    console.error(`sync-version: no "version" field found in ${relPath}.`);
    process.exit(1);
  }
  return match[2];
}

const isCheck = process.argv.includes('--check');
const rootVersion = readRootVersion();

if (isCheck) {
  const drifted = TARGETS.filter((relPath) => currentVersion(relPath) !== rootVersion);
  if (drifted.length > 0) {
    console.error(`sync-version: version drift detected (root is ${rootVersion}):`);
    for (const relPath of drifted) {
      console.error(`  - ${relPath}: ${currentVersion(relPath)}`);
    }
    console.error('Run "node scripts/sync-version.mjs" to fix, or bump with "npm version".');
    process.exit(1);
  }
  console.log(`sync-version: all ${TARGETS.length} targets match root version ${rootVersion}. ✓`);
  process.exit(0);
}

let changed = 0;
for (const relPath of TARGETS) {
  const filePath = path.join(repoRoot, relPath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = before.replace(VERSION_RE, `$1${rootVersion}$3`);
  if (after !== before) {
    fs.writeFileSync(filePath, after);
    console.log(`sync-version: ${relPath} -> ${rootVersion}`);
    changed++;
  }
}
console.log(
  changed === 0
    ? `sync-version: already in sync at ${rootVersion}.`
    : `sync-version: updated ${changed} file(s) to ${rootVersion}.`
);
