import * as path from 'node:path';
import type { PluginRegistryContext, NexusFlowPlugin } from './index.js';
import { registerStorageProvider } from '../adapters/registry.js';

export async function loadPlugins(program: any, pluginsList: string[]): Promise<void> {
  const context: PluginRegistryContext = {
    registerStorageProvider(name, provider) {
      registerStorageProvider(name, provider);
    },
    registerCommand(commandBuilder) {
      commandBuilder(program);
    }
  };

  for (const pluginPath of pluginsList) {
    try {
      let resolvedPath = pluginPath;
      if (pluginPath.startsWith('.') || path.isAbsolute(pluginPath)) {
        resolvedPath = path.resolve(pluginPath);
      }
      
      // Dynamic import works with file:// URLs on Windows
      const fileUrl = resolvedPath.startsWith('file://') ? resolvedPath : `file:///${resolvedPath.replace(/\\/g, '/')}`;
      const module = await import(fileUrl);
      const plugin: NexusFlowPlugin = module.default || module.plugin;
      
      if (plugin && typeof plugin.register === 'function') {
        await plugin.register(context);
      } else {
        console.warn(`Warning: Plugin at "${pluginPath}" does not export a valid NexusFlowPlugin.`);
      }
    } catch (error: any) {
      console.error(`Failed to load plugin "${pluginPath}":`, error.message);
    }
  }
}
