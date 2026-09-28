import { DATA_INVENTORY } from './data-inventory.js';
import { resolveBrandHomeDir, resolveUserStorePath, resolveWorkspaceFilePathSync } from './constants.js';

export function getDataGuide(workspacePath?: string) {
  return {
    classes: DATA_INVENTORY,
    locations: {
      profile: resolveBrandHomeDir(),
      config: resolveUserStorePath('config'),
      projects: resolveUserStorePath('projects'),
      schedules: resolveUserStorePath('schedules'),
      ...(workspacePath ? {
        workspace: workspacePath,
        manifest: resolveWorkspaceFilePathSync(workspacePath, 'manifest').path,
        logs: resolveWorkspaceFilePathSync(workspacePath, 'logsDir').path,
        ledger: resolveWorkspaceFilePathSync(workspacePath, 'chatLedger').path,
      } : {}),
    },
    locationNotice: 'These paths are private to this local view and are excluded from diagnostics. Custom adapters and assistant tools control their own locations. Primary and legacy roots may coexist.',
  };
}

export function renderDataGuide(): string {
  return '# ContextSpace data and privacy\n\n' + DATA_INVENTORY.map(entry =>
    `## ${entry.title}\n\nOwner: ${entry.owner}\nStorage: ${entry.storage}\nNetwork: ${entry.network}\nRetention: ${entry.retention}\nControls: ${entry.controls}\nRecovery: ${entry.recovery}`,
  ).join('\n\n') + '\n';
}
