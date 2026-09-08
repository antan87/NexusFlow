import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { resolveDesktopUserData } from './upgrade.js';

it('retains the installed 2.9 Windows identity while displaying the new brand', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.build.appId).toBe('se.hogia.nexusflow');
  expect(manifest.build.productName).toBe('ContextSpace');
});

it('reuses a populated legacy profile without modifying it or replacing an existing new profile', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-upgrade-'));
  try {
    const oldPath = path.join(root, 'NexusFlow');
    const newPath = path.join(root, 'ContextSpace');
    mkdirSync(oldPath);
    writeFileSync(path.join(oldPath, 'Preferences'), '{"theme":"light"}');
    expect(resolveDesktopUserData(root, newPath)).toBe(oldPath);
    expect(readFileSync(path.join(oldPath, 'Preferences'), 'utf8')).toBe('{"theme":"light"}');
    mkdirSync(newPath);
    expect(resolveDesktopUserData(root, newPath)).toBe(newPath);
    expect(resolveDesktopUserData(root, path.join(root, 'fresh'), () => false)).toBe(path.join(root, 'fresh'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
