import type { WorkspaceMode } from '../../types.js';

export function suggestedBranchName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `feature/${slug}` : '';
}

/**
 * A workspace needs a name and at least one repository. The task description is
 * optional: the backend accepts an empty one, so it must not gate creation.
 */
export function isWorkspaceFormValid(params: {
  workspaceName: string;
  mode: WorkspaceMode;
  branchName?: string;
  selectedRepoCount: number;
}): boolean {
  const inPlace = params.mode === 'in-place';
  const worktreeBranch = (params.branchName ?? '').trim() || suggestedBranchName(params.workspaceName);
  const identityValid = params.workspaceName.trim().length > 0 && (inPlace || worktreeBranch.length > 0);
  return identityValid && params.selectedRepoCount > 0;
}

/**
 * Runs once per finished creation job: opens the CLI start-session dock and
 * lands on the workspace page. Returns the id that was handled so the caller
 * can ignore repeat completions. `autoNavigate: false` is for re-opened job
 * links, which only inspect a finished job and must not take over navigation.
 */
export function handleWorkspaceCreationCompletion(params: {
  status: string;
  workspaceId?: string | null;
  lastOpenedWorkspaceId: string | null;
  autoNavigate?: boolean;
  onOpenCli: (workspaceId: string) => void;
  onNavigate: (path: string) => void;
}): string | null {
  if (params.status !== 'completed' || !params.workspaceId || params.lastOpenedWorkspaceId === params.workspaceId) {
    return params.lastOpenedWorkspaceId;
  }
  if (params.autoNavigate !== false) {
    params.onOpenCli(params.workspaceId);
    params.onNavigate(`/workspaces/${encodeURIComponent(params.workspaceId)}`);
  }
  return params.workspaceId;
}

/**
 * The harness a developer starts with always receives the workspace
 * instructions: choosing it must not depend on also ticking it under Advanced.
 */
export function withStartHarness(assistants: readonly string[], startHarness: string): string[] {
  return startHarness && !assistants.includes(startHarness) ? [...assistants, startHarness] : [...assistants];
}

/**
 * The harness shown as chosen is only ever the developer's own pick, and only
 * while it is installed. Nothing is chosen for them: not a default, and not the
 * tool they used last time.
 */
export function resolveStartHarness(params: { chosen: string; installed: readonly string[] }): string {
  return params.installed.includes(params.chosen) ? params.chosen : '';
}
