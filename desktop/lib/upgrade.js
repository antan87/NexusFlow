import path from 'node:path';
import { existsSync } from 'node:fs';

/** Reuse the previous desktop profile without moving or overwriting user data. */
export function resolveDesktopUserData(appDataPath, currentPath, exists = existsSync) {
  if (exists(currentPath)) return currentPath;
  for (const legacyName of ['NexusFlow', 'nexusflow-desktop']) {
    const legacyPath = path.join(appDataPath, legacyName);
    if (exists(legacyPath)) return legacyPath;
  }
  return currentPath;
}

/** Select the legacy profile before Electron's userData getter creates a new one. */
export function configureDesktopUserData(app) {
  // An explicit Chromium profile override belongs to the caller.
  if (app.commandLine.hasSwitch('user-data-dir')) return;
  const appDataPath = app.getPath('appData');
  const defaultPath = path.join(appDataPath, app.getName());
  const selectedPath = resolveDesktopUserData(appDataPath, defaultPath);
  if (selectedPath !== defaultPath) app.setPath('userData', selectedPath);
}
