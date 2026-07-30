import type { StoragePort, StorageAdapterMeta } from '../ports/storage.js';
import { LocalStorageAdapter } from './local-storage.js';

const storageProviders = new Map<string, StoragePort>();
let activeProvider: StoragePort | null = null;

export function registerStorageProvider(name: string, provider: StoragePort) {
  storageProviders.set(name, provider);
}

// Auto-register built-in adapters.
//
// Only one, deliberately. The port stays because it keeps every writer going
// through one place, which is what lets a plugin add a backend — but a backend
// that moves the generated files out of the workspace cannot work: Claude Code
// reads CLAUDE.md from the workspace root, `@AGENTS.md` resolves relative to it,
// and Codex, Cursor and Devin read AGENTS.md from the root too. The removed
// central-vault adapter wrote all of them to ~/.nexusflow/vault/ instead.
registerStorageProvider('local', new LocalStorageAdapter());

/** Returns metadata for all registered storage providers. */
export function listStorageProviders(): StorageAdapterMeta[] {
  return Array.from(storageProviders.values()).map(p => p.meta);
}

export function getStorageProvider(name: string): StoragePort {
  const provider = storageProviders.get(name);
  if (!provider) {
    throw new Error(`Storage provider "${name}" is not registered.`);
  }
  return provider;
}

export function setActiveStorageProvider(provider: StoragePort) {
  activeProvider = provider;
}

export function getActiveStorageProvider(): StoragePort {
  if (!activeProvider) {
    const local = storageProviders.get('local');
    if (!local) {
      throw new Error('No storage providers registered.');
    }
    return local;
  }
  return activeProvider;
}
