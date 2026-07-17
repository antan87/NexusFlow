/**
 * TanStack Query hooks for the NexusFlow API. One hook per endpoint group;
 * mutations invalidate the queries they affect so screens stay fresh without
 * hand-rolled refetch effects.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './client.js';
import type {
  DetectedAI,
  DetectedEditor,
  Feature,
  NexusFlowConfig,
  Project,
  RepoInfo,
  WorkspaceMode,
  WorkspaceStatus,
} from '../../types.js';

// ─── Config ───────────────────────────────────────────────────────────────────

/** Shape of GET /api/config — the config is wrapped, not top-level. */
export interface ConfigResponse {
  exists: boolean;
  config: NexusFlowConfig;
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => apiFetch<ConfigResponse>('/api/config'),
  });
}

// ─── Workspaces ───────────────────────────────────────────────────────────────

export function useWorkspaces() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () => apiFetch<Feature[]>('/api/workspaces'),
  });
}

/**
 * At-a-glance status per workspace. The endpoint runs `git status` across
 * every repo of every workspace, so callers must gate polling to the routes
 * that actually display statuses (`intervalMs: false` disables polling).
 */
export function useWorkspacesStatus(options: { enabled?: boolean; intervalMs?: number | false } = {}) {
  return useQuery({
    queryKey: ['workspaces-status'],
    queryFn: () => apiFetch<Record<string, WorkspaceStatus>>('/api/workspaces/status'),
    enabled: options.enabled ?? true,
    refetchInterval: options.intervalMs ?? false,
  });
}

export interface CreateWorkspacePayload {
  mode?: WorkspaceMode;
  projectId?: string;
  /** Workspace name — required for in-place mode. */
  name?: string;
  branchName?: string;
  description: string;
  repos: Array<{ name: string; path: string; defaultBranch: string; existingBranch?: string }>;
  assistants: string[];
  teamworkInstructions?: string;
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateWorkspacePayload) =>
      apiFetch<{ success: boolean; jobId: string }>('/api/workspace', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['workspaces-status'] });
    },
  });
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<Project[]>('/api/projects'),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name: string; repos: string[]; description?: string }) =>
      apiFetch<Project>('/api/projects', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name?: string; repos?: string[]; description?: string | null }) =>
      apiFetch<Project>(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

// ─── Repos & detection ────────────────────────────────────────────────────────

export function useRepos() {
  return useQuery({
    queryKey: ['repos'],
    queryFn: () => apiFetch<RepoInfo[]>('/api/repos'),
  });
}

/** Local and origin branches of a repository (mirrors utils/git.ts). */
export interface RepoBranches {
  local: string[];
  remote: string[];
}

/** Branches of one repo, for existing-branch suggestions. Lazy via `enabled`. */
export function useRepoBranches(repoPath: string, enabled: boolean) {
  return useQuery({
    queryKey: ['repo-branches', repoPath],
    queryFn: () => apiFetch<RepoBranches>(`/api/repos/branches?path=${encodeURIComponent(repoPath)}`),
    enabled,
    staleTime: 60_000,
  });
}

/** Scaffolds a brand-new local git repository in the dev directory. */
export function useCreateRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ success: boolean; repo: RepoInfo }>('/api/repos/new', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['repos'] }),
  });
}

export function useAiDetect() {
  return useQuery({
    queryKey: ['ai-detect'],
    queryFn: () => apiFetch<DetectedAI[]>('/api/ai-detect'),
    staleTime: 60_000,
  });
}

export function useEditorDetect() {
  return useQuery({
    queryKey: ['editor-detect'],
    queryFn: () => apiFetch<DetectedEditor[]>('/api/editor-detect'),
    staleTime: 60_000,
  });
}

// ─── Workflow strategy templates ──────────────────────────────────────────────

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  custom: boolean;
}

export function useWorkflowTemplates() {
  return useQuery({
    queryKey: ['workflow-templates'],
    queryFn: async () => {
      const data = await apiFetch<{ templates: WorkflowTemplate[] }>('/api/workflows/templates');
      return data.templates;
    },
  });
}
