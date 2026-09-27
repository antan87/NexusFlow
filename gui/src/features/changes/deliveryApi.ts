/**
 * Requests for reviewed commits, pushes and finishing. Every response is
 * classified — transport failure, HTTP error, unreadable body, or a result —
 * so a failure can never look like an empty success and drop the user's draft.
 */
import { API_BASE } from '../../lib/apiBase.js';
import type { CommitResponse, FinishReport, IsolationPlan } from '../../types.js';

export type RequestOutcome<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; kind: 'network' | 'http' | 'invalid-response'; status?: number; error: string; data?: unknown };

/**
 * POSTs JSON and classifies the outcome. `accept` decides which statuses carry
 * a usable body (e.g. a 409 finish report that explains why it was blocked).
 */
export async function postJson<T>(
  path: string,
  body: unknown,
  isValid: (value: unknown) => value is T,
  accept: (status: number) => boolean = (status) => status >= 200 && status < 300,
): Promise<RequestOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      kind: 'network',
      error: `Could not reach ContextSpace (${error instanceof Error ? error.message : String(error)}). Nothing was confirmed; check the connection and retry.`,
    };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return {
      ok: false,
      kind: 'invalid-response',
      status: response.status,
      error: `The server answered ${response.status} with an unreadable response. Refresh the changes to see what happened before retrying.`,
    };
  }
  if (!accept(response.status)) {
    const message = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
      ? (data as { error: string }).error
      : `Request failed (${response.status}).`;
    return { ok: false, kind: 'http', status: response.status, error: message, data };
  }
  if (!isValid(data)) {
    return {
      ok: false,
      kind: 'invalid-response',
      status: response.status,
      error: 'The server response did not contain the expected results. Refresh the changes before retrying.',
      data,
    };
  }
  return { ok: true, status: response.status, data };
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

export function isCommitResponse(value: unknown): value is CommitResponse {
  return isRecord(value) && Array.isArray(value.results) && Array.isArray(value.skipped);
}

export function isPushResponse(value: unknown): value is { results: Array<{ name: string; pushed: boolean; branch: string; error?: string }> } {
  return isRecord(value) && Array.isArray(value.results);
}

export function isFinishReport(value: unknown): value is FinishReport {
  return isRecord(value) && Array.isArray(value.repos) && isRecord(value.policy) && typeof value.blocked === 'boolean';
}

export function isIsolationPlan(value: unknown): value is IsolationPlan {
  return isRecord(value) && typeof value.worktreePath === 'string' && Array.isArray(value.conflicts);
}

const workspacePath = (wsId: string, suffix: string) => `/api/workspace/${encodeURIComponent(wsId)}/${suffix}`;

export function submitCommit(wsId: string, request: { message: string; files: Record<string, string[]>; noPush: boolean }) {
  return postJson(workspacePath(wsId, 'commit'), request, isCommitResponse);
}

export function submitPush(wsId: string, repos: string[]) {
  return postJson(workspacePath(wsId, 'push'), { repos }, isPushResponse);
}

/** A blocked finish (409) is a result, not a transport error: it explains itself. */
export function submitFinish(wsId: string, request: { message?: string; createPrs: boolean; overrideReason?: string; dryRun?: boolean }) {
  return postJson(workspacePath(wsId, 'finish'), request, isFinishReport, (status) => status === 200 || status === 409);
}

export function planIsolation(wsId: string, repo: string) {
  return postJson(workspacePath(wsId, 'isolate'), { repo, dryRun: true }, isIsolationPlan);
}

export function prepareForEditing(wsId: string, plan: Pick<IsolationPlan, 'repoName' | 'branchName' | 'baseBranch'>) {
  return postJson(
    workspacePath(wsId, 'isolate'),
    { repo: plan.repoName, branchName: plan.branchName, baseBranch: plan.baseBranch },
    (value): value is { success: true } & IsolationPlan => isRecord(value) && value.success === true,
  );
}

/** "github.com/owner/repo" from a remote URL, for a compact destination label. */
export function remoteLabel(remoteUrl: string | null): string {
  if (!remoteUrl) return 'no remote';
  const cleaned = remoteUrl.replace(/\.git$/, '').replace(/^git@([^:]+):/, '$1/').replace(/^[a-z]+:\/\/(?:[^@/]+@)?/, '');
  return cleaned || remoteUrl;
}
