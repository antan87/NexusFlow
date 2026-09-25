import { refreshWorkspace } from './refresh.js';

export type PlanningRefresh = {
  contextRefreshed: boolean;
  contextRefreshError?: string;
};

/** Refresh generated assistant context after a planning mutation without hiding a successful save. */
export async function refreshPlanningContext(workspacePath: string): Promise<PlanningRefresh> {
  try {
    await refreshWorkspace(workspacePath);
    return { contextRefreshed: true };
  } catch (error) {
    return {
      contextRefreshed: false,
      contextRefreshError: error instanceof Error ? error.message : String(error),
    };
  }
}
