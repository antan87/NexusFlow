import type { StoragePort, StorageAdapterMeta } from '../ports/storage.js';
import { LocalStorageAdapter } from './local-storage.js';
import { CentralVaultAdapter } from './vault-storage.js';

const storageProviders = new Map<string, StoragePort>();
let activeProvider: StoragePort | null = null;

export function registerStorageProvider(name: string, provider: StoragePort) {
  storageProviders.set(name, provider);
}

// Auto-register built-in adapters
registerStorageProvider('local', new LocalStorageAdapter());
registerStorageProvider('central-vault', new CentralVaultAdapter());

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
