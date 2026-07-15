import type { Tone } from '../components/legacy-ui/index.js';
import type { WorkspaceStatus } from '../types.js';

/** Maps a workspace sync status to a display label + status-language tone. */
export function syncMeta(status: WorkspaceStatus['syncStatus']): { label: string; tone: Tone } {
  switch (status) {
    case 'up-to-date':
      return { label: 'In sync', tone: 'success' };
    case 'rebased':
      return { label: 'Rebased', tone: 'accent' };
    case 'conflict':
    case 'stash-conflict':
      return { label: 'Sync conflict', tone: 'danger' };
    case 'error':
      return { label: 'Sync error', tone: 'danger' };
    default:
      return { label: 'Not synced', tone: 'idle' };
  }
}

/** Short repo basename from a full path. */
export function repoName(repoPath: string): string {
  return repoPath.split(/[\\/]/).pop() || repoPath;
}
