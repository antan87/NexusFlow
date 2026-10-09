import type { WorkspaceMode } from '../../types.js';

export function suggestedBranchName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `feature/${slug}` : '';
}

/** The branch a worktree workspace is created on: the one typed, else one derived from the name. */
export function resolveWorktreeBranch(branchName: string | undefined, workspaceName: string): string {
  return (branchName ?? '').trim() || suggestedBranchName(workspaceName);
}

/** What the strategy and skill suggestions read: the task if there is one, else the workspace name. */
export function taskTextForSuggestions(description: string, workspaceName: string): string {
  return description.trim() || workspaceName.trim();
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
  const worktreeBranch = resolveWorktreeBranch(params.branchName, params.workspaceName);
  const identityValid = params.workspaceName.trim().length > 0 && (inPlace || worktreeBranch.length > 0);
  return identityValid && params.selectedRepoCount > 0;
}

/**
 * Runs once per finished creation job: makes the chosen harness the preferred
 * one for the new workspace, opens the CLI start-session dock and lands on the
 * workspace page. Returns the id that was acted on so the caller can ignore
 * repeat completions.
 *
 * `autoNavigate: false` is for re-opened job links, which only inspect a
 * finished job. They do nothing, and must not mark the workspace as handled: a
 * later creation of the same workspace in this page still has to open it.
 *
 * The harness is applied here, once the workspace exists, so a creation that
 * fails never leaves a preference behind for a workspace that was not made.
 */
export function handleWorkspaceCreationCompletion(params: {
  status: string;
  workspaceId?: string | null;
  lastOpenedWorkspaceId: string | null;
  autoNavigate?: boolean;
  startHarness?: string;
  onChooseHarness?: (workspaceId: string, harness: string) => void;
  onOpenCli: (workspaceId: string) => void;
  onNavigate: (path: string) => void;
}): string | null {
  if (params.status !== 'completed' || !params.workspaceId || params.lastOpenedWorkspaceId === params.workspaceId) {
    return params.lastOpenedWorkspaceId;
  }
  if (params.autoNavigate === false) return params.lastOpenedWorkspaceId;
  if (params.startHarness) params.onChooseHarness?.(params.workspaceId, params.startHarness);
  params.onOpenCli(params.workspaceId);
  params.onNavigate(`/workspaces/${encodeURIComponent(params.workspaceId)}`);
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

/** "shop-api, shop-web +2": the first few names and how many more there are, for places with little room. */
export function summarizeNames(names: readonly string[], show = 2): string {
  const shown = names.slice(0, show).join(', ');
  const more = names.length - show;
  return more > 0 ? `${shown} +${more}` : shown;
}
