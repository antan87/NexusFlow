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
