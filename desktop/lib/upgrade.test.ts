import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { configureDesktopUserData, resolveDesktopUserData } from './upgrade.js';

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


it('selects the existing profile before a side-effectful Electron getter creates the new one', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-profile-startup-'));
  try {
    const legacyPath = path.join(root, 'NexusFlow');
    const currentPath = path.join(root, 'ContextSpace');
    mkdirSync(legacyPath);
    writeFileSync(path.join(legacyPath, 'Preferences'), '{"existing":true}');
    let selectedPath = currentPath;
    const app = {
      commandLine: { hasSwitch: () => false },
      getName: () => 'ContextSpace',
      getPath: (name: string) => {
        if (name === 'appData') return root;
        // Electron 43 creates userData on lookup; reproduce that side effect.
        mkdirSync(selectedPath, { recursive: true });
        return selectedPath;
      },
      setPath: (_name: string, value: string) => { selectedPath = value; },
    };
    configureDesktopUserData(app);
    expect(app.getPath('userData')).toBe(legacyPath);
    expect(readFileSync(path.join(selectedPath, 'Preferences'), 'utf8')).toBe('{"existing":true}');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('preserves an explicit profile override without inspecting default profiles', () => {
  const app = {
    commandLine: { hasSwitch: (name: string) => name === 'user-data-dir' },
    getPath: vi.fn(() => { throw new Error('Default profile must not be queried'); }),
    getName: vi.fn(),
    setPath: vi.fn(),
  };
  configureDesktopUserData(app);
  expect(app.setPath).not.toHaveBeenCalled();
});
