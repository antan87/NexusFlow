import { HarnessIcon } from '../components/icons/HarnessIcon.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, CircleAlert, FolderGit2, GitBranch, Sparkles, Zap, Boxes, Bot, RefreshCw, Tag } from 'lucide-react';

import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Textarea } from '../components/ui/textarea.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { Spinner } from '../components/ui/spinner.js';
import { StatusBadge } from '../components/ui/status-badge.js';
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from '../components/ui/dialog.js';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { RepoChecklist } from '../components/RepoChecklist.js';
import { cn } from '../lib/utils.js';
import { repoName } from '../lib/status.js';
import { apiFetch } from '../lib/api/client.js';
import {
  useAiDetect,
  useCreateWorkspace,
  useDomainPacks,
  useCreateDomainPack,
  useProjects,
  useRepoBranches,
  useRepos,
  useWorkflowTemplates,
  useSkills,
  useAgents,
  useReposFreshness,
  usePullRepos,
  type CreateWorkspacePayload,
} from '../lib/api/queries.js';
import { ScaffoldRepoInline } from '../components/ScaffoldRepoInline.js';
import { useCreationStream, type CreationStep } from '../lib/api/useCreationStream.js';
import type { RepoInfo, RepoFreshness, WorkspaceMode, WorkGuidance } from '../types.js';
import { WorkspaceLauncher } from '../features/workspace-launch/WorkspaceLauncher.js';

/** Sentinel select value for ad-hoc repo picking. */
const AD_HOC = '__ad-hoc__';

const isVsCode = new URLSearchParams(window.location.search).get('env') === 'vscode';

const FLOW_OPTIONS = [
  { value: 'quick', title: 'Small task', body: 'Make and verify a focused change.' },
  { value: 'feature', title: 'Standard change', body: 'Plan, implement, verify, and review a feature.' },
  { value: 'epic', title: 'Epic', body: 'Track a larger change through dependent milestones.' },
] as const;

const MODE_OPTIONS: Array<{ value: WorkspaceMode; icon: typeof Zap; title: string; body: string }> = [
  {
    value: 'in-place',
    icon: Zap,
    title: 'In-place',
    body: 'Work directly in the source repos. No branches or worktrees — fastest start.',
  },
  {
    value: 'worktree',
    icon: GitBranch,
    title: 'Isolated worktrees',
    body: 'A feature branch and worktree per repo. Your source checkouts stay untouched.',
  },
];

/**
 * One per-repo existing-branch override input, with the repo's real branches
 * offered as datalist suggestions (fetched lazily once the section opens —
 * the server still enforces existence, this just prevents typos up front).
 */
function BranchOverrideRow({
  repo,
  value,
  onChange,
  enabled,
}: {
  repo: RepoInfo;
  value: string;
  onChange: (v: string) => void;
  enabled: boolean;
}) {
  const branches = useRepoBranches(repo.path, enabled);
  const options = useMemo(
    () => [...new Set([...(branches.data?.local ?? []), ...(branches.data?.remote ?? [])])],
    [branches.data],
  );
  const listId = `branches-${repo.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
  return (
    <label className="flex items-center gap-2">
      <span className="w-40 shrink-0 truncate text-xs">{repo.name}</span>
      <Input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="existing branch (must exist)"
        className="h-7 font-mono text-xs"
      />
      <datalist id={listId}>
        {options.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
    </label>
  );
}

function StepRow({ step }: { step: CreationStep }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full border',
          step.status === 'completed' && 'border-success bg-success/15 text-success-foreground',
          step.status === 'running' && 'border-primary text-primary',
          step.status === 'failed' && 'border-destructive bg-destructive/15 text-destructive-foreground',
          step.status === 'pending' && 'border-border text-muted-foreground',
        )}
      >
        {step.status === 'completed' ? (
          <Check className="size-3" />
        ) : step.status === 'running' ? (
          <Spinner className="size-3" />
        ) : step.status === 'failed' ? (
          <CircleAlert className="size-3" />
        ) : null}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{step.name}</p>
        <p className="truncate text-xs text-muted-foreground">{step.message}</p>
      </div>
    </li>
  );
}

export function StartWorkPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projects = useProjects();
  const repos = useRepos();
  const aiDetect = useAiDetect();
  const templates = useWorkflowTemplates();
  const skillsQuery = useSkills();
  const agentsQuery = useAgents();
  const domainPacksQuery = useDomainPacks();
  const createWorkspace = useCreateWorkspace();
  const { progress, start, reset } = useCreationStream();
  const creationJobId = searchParams.get('job');

  const [projectId, setProjectId] = useState<string>(searchParams.get('project') ?? AD_HOC);
  const [workType, setWorkType] = useState<WorkGuidance['workType']>('feature');
  const [flowType, setFlowType] = useState<'quick' | 'feature' | 'epic'>('feature');
  const [mode, setMode] = useState<WorkspaceMode>('in-place');
  const [branchName, setBranchName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [adHocPaths, setAdHocPaths] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [assistants, setAssistants] = useState<string[]>([]);
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [enabledAgents, setEnabledAgents] = useState<string[]>([]);
  const [strategyId, setStrategyId] = useState<string>('');
  /** Editable teamwork instructions; prefilled by strategy pick or AI suggestion. */
  const [customInstructions, setCustomInstructions] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedDifficulty, setSuggestedDifficulty] = useState<string | null>(null);

  /** Optional per-repo existing branch (keyed by repo PATH — names can repeat). */
  const [branchOverrides, setBranchOverrides] = useState<Record<string, string>>({});
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Tag creation modal state
  const [showCreateTagModal, setShowCreateTagModal] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagId, setNewTagId] = useState('');
  const [newTagDescription, setNewTagDescription] = useState('');
  const [newTagType, setNewTagType] = useState<'vertical' | 'trait'>('vertical');
  const [newTagVerifyCmd, setNewTagVerifyCmd] = useState('');
  const [savingNewTag, setSavingNewTag] = useState(false);

  const createDomainPackMutation = useCreateDomainPack();

  const handleCreateNewTag = async () => {
    if (!newTagName.trim() || !newTagId.trim()) return;
    setSavingNewTag(true);
    try {
      const id = newTagId.trim().toLowerCase();
      await createDomainPackMutation.mutateAsync({
        id,
        name: newTagName.trim(),
        description: newTagDescription.trim() || newTagName.trim(),
        categoryType: newTagType,
        verifyCommand: newTagVerifyCmd.trim() || undefined,
        tags: [id, ...newTagName.trim().toLowerCase().split(/\s+/).filter(Boolean)],
      });
      setSelectedTags((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setShowCreateTagModal(false);
      setNewTagName('');
      setNewTagId('');
      setNewTagDescription('');
      setNewTagVerifyCmd('');
    } catch {
      // Handled
    } finally {
      setSavingNewTag(false);
    }
  };

  /** Keyword-based auto-suggestions from what the developer types in description */
  const suggestedMatches = useMemo(() => {
    if (!description.trim() || description.trim().length < 3) return [];
    const text = description.toLowerCase();
    const suggestions: Array<{ id: string; title: string; type: 'tag' | 'skill' }> = [];

    // Match tags
    for (const pack of domainPacksQuery.data ?? []) {
      if (selectedTags.includes(pack.id)) continue;
      const terms = [pack.id, pack.name, ...(pack.tags ?? [])];
      if (terms.some((term) => term && text.includes(term.toLowerCase()))) {
        suggestions.push({ id: pack.id, title: `#${pack.id}`, type: 'tag' });
      }
    }

    // Match skills
    for (const skill of skillsQuery.data ?? []) {
      if (enabledSkills.includes(skill.id)) continue;
      const terms = [skill.id, skill.name, skill.title, ...(skill.tags ?? [])];
      if (terms.some((term) => term && term.length > 2 && text.includes(term.toLowerCase()))) {
        suggestions.push({ id: skill.id, title: skill.title || skill.name, type: 'skill' });
      }
    }

    return suggestions.slice(0, 6);
  }, [description, domainPacksQuery.data, skillsQuery.data, selectedTags, enabledSkills]);

  useEffect(() => {
    if (creationJobId) {
      start(creationJobId);
    } else {
      reset();
    }
  }, [creationJobId, reset, start]);

  const returnToForm = () => {
    reset();
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.delete('job');
      return next;
    }, { replace: true });
  };

  const startOver = () => {
    const url = new URL(window.location.href);
    url.hash = '#/new';
    window.location.replace(url.toString());
  };

  const retryObservation = () => {
    if (creationJobId) start(creationJobId);
  };

  const selectedProject = useMemo(
    () => (projects.data ?? []).find((p) => p.id === projectId) ?? null,
    [projects.data, projectId],
  );

  const selectedRepos: RepoInfo[] = useMemo(() => {
    if (selectedProject) {
      return selectedProject.repos.map((r) => ({
        name: repoName(r.path),
        path: r.path,
        defaultBranch: r.defaultBranch,
      }));
    }
    return (repos.data ?? []).filter((r) => adHocPaths.includes(r.path));
  }, [selectedProject, repos.data, adHocPaths]);

  const [autoUpdateBase, setAutoUpdateBase] = useState(true);
  const [pullWarning, setPullWarning] = useState<string | null>(null);
  const pullRepos = usePullRepos();

  const reposToCheck = useMemo(() => {
    return selectedRepos.map((r) => ({
      path: r.path,
      branch: branchOverrides[r.path] || r.defaultBranch,
    }));
  }, [selectedRepos, branchOverrides]);

  const freshnessQuery = useReposFreshness(reposToCheck, reposToCheck.length > 0);

  const freshnessMap: Record<string, RepoFreshness> = useMemo(() => {
    const map: Record<string, RepoFreshness> = {};
    for (const item of freshnessQuery.data ?? []) {
      map[item.repoPath] = item;
    }
    return map;
  }, [freshnessQuery.data]);

  const behindRepos = useMemo(() => {
    return (freshnessQuery.data ?? []).filter((f) => f.status === 'behind');
  }, [freshnessQuery.data]);

  const pullAllBehind = async () => {
    setPullWarning(null);
    try {
      const res = await pullRepos.mutateAsync({
        repos: behindRepos.map((r) => ({ path: r.repoPath, branch: r.branch })),
      });
      const dirtyFails = res.results.filter((r) => r.status === 'dirty' || r.status === 'diverged');
      if (dirtyFails.length > 0) {
        setPullWarning(
          `Could not update ${dirtyFails.length} repo(s): ${dirtyFails.map((d) => `${d.repoName} (${d.message})`).join('; ')}`,
        );
      }
    } catch (err) {
      setPullWarning(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePullSingle = async (repoPath: string, branch: string) => {
    setPullWarning(null);
    try {
      const res = await pullRepos.mutateAsync({ path: repoPath, branch });
      const fail = res.results.find((r) => !r.success);
      if (fail) {
        setPullWarning(`Could not update ${fail.repoName}: ${fail.message}`);
      }
    } catch (err) {
      setPullWarning(err instanceof Error ? err.message : String(err));
    }
  };

  const inPlace = mode === 'in-place';
  const identityValid = inPlace ? workspaceName.trim().length > 0 : branchName.trim().length > 0;
  const formValid = identityValid && selectedRepos.length > 0 && description.trim().length > 0;

  const applyStrategy = (id: string) => {
    setStrategyId(id);
    setSuggestedDifficulty(null);
    const template = (templates.data ?? []).find((t) => t.id === id);
    setCustomInstructions(template?.content ?? '');
  };

  const suggestStrategy = async () => {
    if (!description.trim()) {
      setSubmitError('Describe what you are building first — the suggestion is based on it.');
      return;
    }
    setSubmitError(null);
    setSuggesting(true);
    try {
      const data = await apiFetch<{
        success: boolean;
        difficulty: string;
        suggestedWorkflowId: string;
        customInstructions: string;
      }>('/api/workspace/suggest-workflow', {
        method: 'POST',
        body: JSON.stringify({ description, repos: selectedRepos }),
      });
      setStrategyId(data.suggestedWorkflowId);
      setCustomInstructions(data.customInstructions);
      setSuggestedDifficulty(data.difficulty);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSuggesting(false);
    }
  };

  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current || createWorkspace.isPending || !formValid) return;
    submittingRef.current = true;
    setSubmitError(null);
    const payload: CreateWorkspacePayload = {
      flowType,
      workType,
      mode,
      projectId: selectedProject?.id,
      ...(inPlace ? { name: workspaceName.trim() } : { branchName: branchName.trim() }),
      description: description.trim(),
      repos: selectedRepos.map((repo) => ({
        ...repo,
        existingBranch:
          !inPlace && branchOverrides[repo.path]?.trim() ? branchOverrides[repo.path].trim() : undefined,
      })),
      assistants,
      enabledSkills: enabledSkills.length > 0 ? enabledSkills : undefined,
      enabledAgents: enabledAgents.length > 0 ? enabledAgents : undefined,
      domainPacks: selectedTags.length > 0 ? selectedTags : undefined,
      teamworkInstructions: customInstructions.trim() || undefined,
      autoUpdateBase,
    };
    try {
      const { jobId } = await createWorkspace.mutateAsync(payload);
      start(jobId);
      setSearchParams((params) => {
        const next = new URLSearchParams(params);
        next.set('job', jobId);
        return next;
      }, { replace: true });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      submittingRef.current = false;
    }
  };

  // ── Creation progress / result panel ─────────────────────────────────────
  const displayedProgress = progress.status === 'idle' && creationJobId
    ? { status: 'running' as const, steps: [] }
    : progress;

  if (displayedProgress.status !== 'idle') {
    const failedStep = displayedProgress.steps.find((s) => s.status === 'failed');
    return (
      <div className="mx-auto max-w-xl animate-fade-in">
        <h1 className="text-xl font-semibold">
          {displayedProgress.status === 'running'
            ? 'Setting up your workspace…'
            : displayedProgress.status === 'completed'
              ? 'Workspace ready'
              : displayedProgress.status === 'failed'
                ? 'Workspace creation failed'
                : 'Unable to reconnect to workspace setup'}
        </h1>
        <ul
          aria-live="polite"
          aria-relevant="additions text"
          className="mt-6 divide-y divide-border rounded-xl border border-border bg-card px-4"
        >
          {displayedProgress.steps.length > 0 ? (
            displayedProgress.steps.map((step) => <StepRow key={step.id} step={step} />)
          ) : (
            <li className="flex items-center gap-3 py-3.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Spinner className="size-3" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">Connecting to workspace setup…</p>
                <p className="text-xs text-muted-foreground">Waiting for creation progress…</p>
              </div>
            </li>
          )}
        </ul>
        {(displayedProgress.status === 'failed' || displayedProgress.status === 'unavailable') && (
          <p className="mt-4 text-sm text-destructive-foreground">
            {failedStep?.message ?? displayedProgress.error ?? 'Something went wrong.'}
          </p>
        )}
        {displayedProgress.status === 'completed' && displayedProgress.workspacePath && (
          <p className="mt-4 truncate font-mono text-xs text-muted-foreground">{displayedProgress.workspacePath}</p>
        )}
        {submitError && <p className="mt-2 text-sm text-destructive-foreground">{submitError}</p>}
        <div data-testid="workspace-ready-actions" className="mt-6 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
          {displayedProgress.status === 'completed' && displayedProgress.workspaceId && (
            <>
              <Button
                className="w-full min-w-0 whitespace-normal sm:w-auto"
                onClick={() => navigate(`/workspaces/${encodeURIComponent(displayedProgress.workspaceId!)}`)}
              >
                Open workspace
              </Button>
              {displayedProgress.workspacePath && (
                <WorkspaceLauncher
                  workspaceId={displayedProgress.workspaceId}
                  workspacePath={displayedProgress.workspacePath}
                  isVsCode={isVsCode}
                  className="w-full min-w-0 whitespace-normal sm:w-auto"
                />
              )}
            </>
          )}
          {displayedProgress.status === 'failed' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="default" onClick={returnToForm}>
                Back to form (edit & retry)
              </Button>
              <Button variant="outline" onClick={startOver}>
                Start over (clear form)
              </Button>
            </div>
          )}
          {displayedProgress.status === 'unavailable' && (
            <div className="flex flex-wrap gap-2">
              <Button variant="default" onClick={retryObservation}>
                Try reconnecting
              </Button>
              <Button variant="outline" onClick={returnToForm}>
                Back to form
              </Button>
            </div>
          )}
          {displayedProgress.status === 'running' && (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">This can take a moment for large repositories.</p>
              <Button variant="outline" size="sm" onClick={returnToForm}>
                Return to form
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── The form ─────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-xl animate-fade-in">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Start work</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick where the work happens and how isolated it should be.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        {/* 1. Project */}
        <section>
          <span className="mb-1.5 block text-sm font-medium">Project</span>
          <Select value={projectId} onValueChange={(v) => typeof v === 'string' && setProjectId(v)}>
            <SelectTrigger className="w-full" aria-label="Project">
              <SelectValue>
                {selectedProject ? selectedProject.name : 'Ad-hoc — pick repositories manually'}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {(projects.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
              <SelectItem value={AD_HOC}>Ad-hoc — pick repositories manually</SelectItem>
            </SelectPopup>
          </Select>
          {selectedProject ? (
            <ul className="mt-2 flex flex-col gap-0.5">
              {selectedProject.repos.map((r) => (
                <li key={r.path} className="truncate font-mono text-xs text-muted-foreground">
                  {r.path}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2">
              <RepoChecklist
                repos={repos.data ?? []}
                selectedPaths={adHocPaths}
                onToggle={(repo) =>
                  setAdHocPaths((prev) =>
                    prev.includes(repo.path) ? prev.filter((p) => p !== repo.path) : [...prev, repo.path],
                  )
                }
                loading={repos.isLoading}
                freshnessMap={freshnessMap}
              />
              <ScaffoldRepoInline onCreated={(repo) => setAdHocPaths((prev) => [...prev, repo.path])} />
            </div>
          )}

          {selectedRepos.length > 0 && (
            <div className="mt-3 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <GitBranch className="size-3.5" />
                  Base repository sync ({selectedRepos.length})
                </span>
                <div className="flex items-center gap-2">
                  {behindRepos.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2"
                      onClick={pullAllBehind}
                      disabled={pullRepos.isPending}
                    >
                      {pullRepos.isPending ? <Spinner className="size-3 mr-1" /> : <RefreshCw className="size-3 mr-1" />}
                      Pull {behindRepos.length} stale {behindRepos.length === 1 ? 'repo' : 'repos'}
                    </Button>
                  )}
                </div>
              </div>
              <ul className="mt-2 divide-y divide-border text-xs">
                {selectedRepos.map((repo) => {
                  const freshness = freshnessMap[repo.path];
                  const isBehind = freshness?.status === 'behind';
                  return (
                    <li key={repo.path} className="flex items-center justify-between py-1.5">
                      <div className="min-w-0 flex-1 truncate pr-2">
                        <span className="font-medium">{repo.name}</span>
                        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                          ({branchOverrides[repo.path] || repo.defaultBranch})
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {freshnessQuery.isLoading ? (
                          <span className="text-muted-foreground text-[11px]">Checking…</span>
                        ) : freshness ? (
                          <StatusBadge
                            tone={
                              freshness.status === 'up-to-date'
                                ? 'success'
                                : freshness.status === 'behind'
                                  ? 'warning'
                                  : freshness.status === 'diverged'
                                    ? 'danger'
                                    : freshness.status === 'ahead'
                                      ? 'info'
                                      : 'neutral'
                            }
                            title={freshness.message}
                          >
                            {freshness.status === 'behind'
                              ? `↓ ${freshness.behind} behind ${freshness.trackingBranch}`
                              : freshness.status === 'up-to-date'
                                ? 'Up to date'
                                : freshness.status === 'diverged'
                                  ? 'Diverged'
                                  : freshness.status === 'ahead'
                                    ? `↑ ${freshness.ahead} ahead`
                                    : 'Local'}
                          </StatusBadge>
                        ) : null}
                        {isBehind && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 px-1.5 text-[11px] text-amber-500 hover:text-amber-600"
                            onClick={() =>
                              handlePullSingle(
                                repo.path,
                                branchOverrides[repo.path] || repo.defaultBranch,
                              )
                            }
                            disabled={pullRepos.isPending}
                          >
                            Pull
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {pullWarning && (
                <p className="mt-2 text-xs text-amber-500">{pullWarning}</p>
              )}
            </div>
          )}

          {(projects.data ?? []).length === 0 && !projects.isLoading && (
            <p className="mt-2 text-xs text-muted-foreground">
              Tip: <Link to="/projects" className="text-primary hover:underline">register a project</Link> to skip
              repo picking next time.
            </p>
          )}
        </section>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">What kind of work is this?</legend>
          <label className="mb-3 block text-sm">Work type
            <select aria-label="Work type" className="mt-1 block w-full rounded-md border border-border bg-background p-2" value={workType} onChange={(event) => setWorkType(event.target.value as WorkGuidance['workType'])}>
              <option value="bug">Bug fix</option><option value="feature">Feature</option><option value="performance">Performance</option><option value="refactor">Refactor</option><option value="rewrite">Rewrite</option>
            </select>
          </label>
          <p className="mb-3 text-xs text-muted-foreground">Choose a starting size and milestone preset. You can edit milestones in Plan.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {FLOW_OPTIONS.map((option) => (
              <label key={option.value} className={cn(
                'cursor-pointer rounded-xl border p-4 focus-within:ring-2 focus-within:ring-ring',
                flowType === option.value ? 'border-primary bg-primary/5' : 'border-border bg-card',
              )}>
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <input type="radio" name="flowType" value={option.value} checked={flowType === option.value}
                    onChange={() => setFlowType(option.value)} aria-label={option.title} aria-describedby={`flow-${option.value}-description`}
                    className="accent-primary" />
                  {option.title}
                </span>
                <p id={`flow-${option.value}-description`} className="mt-2 text-xs text-muted-foreground">{option.body}</p>
              </label>
            ))}
          </div>
        </fieldset>

        {/* 2. Mode */}
        <section>
          <span className="mb-1.5 block text-sm font-medium">How do you want to work?</span>
          {/* Hand-rolled radio cards: Base UI's Radio is a bare circular
              control that cannot wrap card content, so semantics are provided
              directly (role, aria-checked, arrow-key roving focus). */}
          <div
            role="radiogroup"
            aria-label="Work mode"
            className="grid gap-3 sm:grid-cols-2"
            onKeyDown={(e) => {
              if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
                e.preventDefault();
                const next = mode === 'in-place' ? 'worktree' : 'in-place';
                setMode(next);
                document.getElementById(`mode-${next}`)?.focus();
              }
            }}
          >
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                id={`mode-${option.value}`}
                type="button"
                role="radio"
                aria-checked={mode === option.value}
                tabIndex={mode === option.value ? 0 : -1}
                onClick={() => setMode(option.value)}
                className={cn(
                  'cursor-pointer rounded-xl border p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  mode === option.value
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border bg-card hover:border-foreground/20',
                )}
              >
                <option.icon
                  className={cn('size-4', mode === option.value ? 'text-primary' : 'text-muted-foreground')}
                />
                <p className="mt-2 text-sm font-semibold">{option.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{option.body}</p>
              </button>
            ))}
          </div>
        </section>

        {/* 3. Identity */}
        <section>
          {inPlace ? (
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Workspace name</span>
              <Input
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="e.g. Fix invoice rounding"
              />
            </label>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Feature branch</span>
                <Input
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="e.g. feature/invoice-rounding"
                  className="font-mono"
                />
              </label>
              {selectedRepos.length > 0 && (
                <details
                  className="rounded-lg border border-border px-3 py-2"
                  onToggle={(e) => setOverridesOpen((e.target as HTMLDetailsElement).open)}
                >
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Use an existing branch for specific repos (optional)
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    {selectedRepos.map((repo) => (
                      <BranchOverrideRow
                        key={repo.path}
                        repo={repo}
                        enabled={overridesOpen}
                        value={branchOverrides[repo.path] ?? ''}
                        onChange={(v) => setBranchOverrides((prev) => ({ ...prev, [repo.path]: v }))}
                      />
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          <label className="mt-3 flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
            <Checkbox
              checked={autoUpdateBase}
              onCheckedChange={(c) => setAutoUpdateBase(Boolean(c))}
              aria-label="Fast-forward clean base branches before creating workspace"
            />
            <span>Fast-forward clean base branches to latest remote commits</span>
          </label>
        </section>

        {/* 4. Description */}
        <section>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">What are you building?</span>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description — your AI assistant reads this to plan the work."
              rows={3}
            />
          </label>
          {suggestedMatches.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-primary/5 border border-primary/20 text-xs">
              <span className="text-primary font-medium flex items-center gap-1 text-[11px]">
                <Sparkles className="size-3" /> Suggested for this task:
              </span>
              {suggestedMatches.map((item) => (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  onClick={() => {
                    if (item.type === 'tag') {
                      setSelectedTags((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
                    } else {
                      setEnabledSkills((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-card border border-primary/30 text-[11px] font-mono hover:bg-primary/10 transition-colors text-foreground"
                >
                  <span>+{item.title}</span>
                  <Badge variant="outline" className="text-[8px] px-0.5 py-0 uppercase">
                    {item.type}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 5. Category & Domain Tags (Skill Bundles) */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-1.5">
              <Tag className="size-4 text-primary" />
              Category & Domain Tags
              {selectedTags.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  ({selectedTags.length} attached)
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Tags attach curated skill bundles & standards
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setShowCreateTagModal(true)}
                className="h-6 text-xs gap-1 px-2 border-primary/40 text-primary hover:bg-primary/10"
              >
                <Tag className="size-3" />
                + New Tag
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {domainPacksQuery.isLoading ? (
              <div className="flex items-center justify-center p-4 gap-2 text-xs text-muted-foreground rounded-lg border border-border">
                <Spinner className="size-3" />
                Loading category tags...
              </div>
            ) : (domainPacksQuery.data ?? []).length === 0 ? (
              <div className="p-3.5 border border-border rounded-xl bg-card/40 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-foreground">No domain tags defined yet</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Tags are optional bundles that package skills, rules, and test commands for a domain. You can create a tag now, or select skills directly below.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => setShowCreateTagModal(true)}
                    className="text-xs gap-1.5 h-7 shrink-0 text-primary border-primary/40 hover:bg-primary/10"
                  >
                    <Tag className="size-3 text-primary" />
                    + Create Tag
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(domainPacksQuery.data ?? []).map((pack) => {
                  const isChecked = selectedTags.includes(pack.id);
                  const skillCount = pack.skills?.length ?? 0;
                  const ruleCount = pack.rules?.length ?? 0;
                  return (
                    <div
                      key={pack.id}
                      onClick={() =>
                        setSelectedTags((prev) =>
                          prev.includes(pack.id) ? prev.filter((id) => id !== pack.id) : [...prev, pack.id],
                        )
                      }
                      className={cn(
                        'flex flex-col justify-between p-3 rounded-xl border cursor-pointer transition-colors text-left outline-none select-none',
                        isChecked
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                          : 'border-border bg-card hover:border-foreground/20',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() =>
                              setSelectedTags((prev) =>
                                prev.includes(pack.id) ? prev.filter((id) => id !== pack.id) : [...prev, pack.id],
                              )
                            }
                            aria-label={`Attach ${pack.name}`}
                          />
                          <span className="font-medium text-xs font-mono">#{pack.id}</span>
                        </div>
                        {pack.categoryType && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0 capitalize">
                            {pack.categoryType === 'trait' ? 'trait' : 'domain'}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{pack.description || pack.name}</p>
                      {(skillCount > 0 || ruleCount > 0) && (
                        <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap gap-1 items-center text-[10px]">
                          {skillCount > 0 && (
                            <span className="text-primary font-mono flex items-center gap-1">
                              <Boxes className="size-2.5" />
                              {pack.skills!.join(', ')}
                            </span>
                          )}
                          {ruleCount > 0 && (
                            <span className="text-muted-foreground ml-auto font-mono">
                              {ruleCount} rule{ruleCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Direct Agent Skills Selection */}
          <div className="mt-4 pt-4 border-t border-border/60">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <Boxes className="size-4 text-primary" />
                Direct Agent Skills
                {enabledSkills.length > 0 && (
                  <span className="text-xs text-muted-foreground font-normal">
                    ({enabledSkills.length} selected)
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {(skillsQuery.data ?? []).length > 0 && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      const all = (skillsQuery.data ?? []).map((s) => s.id);
                      setEnabledSkills(enabledSkills.length === all.length ? [] : all);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground h-6 px-2"
                  >
                    {enabledSkills.length === (skillsQuery.data ?? []).length && (skillsQuery.data ?? []).length > 0
                      ? 'Deselect All'
                      : 'Select All'}
                  </Button>
                )}
                <Link
                  to="/skills"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  Skill Library →
                </Link>
              </div>
            </div>

            {skillsQuery.isLoading ? (
              <div className="flex items-center justify-center p-3 gap-2 text-xs text-muted-foreground rounded-lg border border-border">
                <Spinner className="size-3" />
                Loading skills...
              </div>
            ) : (skillsQuery.data ?? []).length === 0 ? (
              <div className="p-3 border border-dashed border-border rounded-lg bg-card/20 text-center">
                <p className="text-xs text-muted-foreground">
                  No skills in your catalog yet. You can create skills in the{' '}
                  <Link to="/skills" className="text-primary underline">
                    Skill Library
                  </Link>{' '}
                  or let AI agents create them during development.
                </p>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(skillsQuery.data ?? []).map((skill) => {
                  const isChecked = enabledSkills.includes(skill.id);
                  return (
                    <div
                      key={skill.id}
                      onClick={() =>
                        setEnabledSkills((prev) =>
                          prev.includes(skill.id) ? prev.filter((id) => id !== skill.id) : [...prev, skill.id],
                        )
                      }
                      className={cn(
                        'flex items-center justify-between gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors select-none text-left',
                        isChecked
                          ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/40 text-foreground'
                          : 'border-border bg-card hover:border-foreground/20 text-muted-foreground',
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() =>
                            setEnabledSkills((prev) =>
                              prev.includes(skill.id) ? prev.filter((id) => id !== skill.id) : [...prev, skill.id],
                            )
                          }
                          aria-label={`Select ${skill.title || skill.name}`}
                        />
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-medium truncate text-foreground">
                            {skill.title || skill.name}
                          </p>
                          {skill.description && (
                            <p className="text-[11px] text-muted-foreground line-clamp-1">
                              {skill.description}
                            </p>
                          )}
                        </div>
                      </div>
                      {skill.category && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 capitalize">
                          {skill.category}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 6. Explicit harness choices */}
        <section className="rounded-lg border border-border bg-card p-4" aria-label="AI harnesses">
              <div>
                <span className="mb-1.5 block text-sm font-medium">AI harnesses</span>
                <p className="mb-3 text-xs text-muted-foreground">Choose which tools receive workspace instructions. This does not start a session or choose a default harness.</p>
                <div className="flex flex-wrap gap-3">
                  {(aiDetect.data ?? []).map((assistant) => (
                    <label
                      key={assistant.name}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm',
                        !assistant.detected && 'opacity-50',
                      )}
                    >
                      <Checkbox
                        checked={assistants.includes(assistant.name)}
                        onCheckedChange={() =>
                          setAssistants((prev) =>
                            prev.includes(assistant.name)
                              ? prev.filter((a) => a !== assistant.name)
                              : [...prev, assistant.name],
                          )
                        }
                      />
                      <HarnessIcon harness={assistant.name} />{assistant.displayName}{!assistant.detected && <span className="text-xs text-muted-foreground">Not installed</span>}
                    </label>
                  ))}
                </div>
              </div>

        </section>

        <section className="rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-accent"
            aria-expanded={advancedOpen}
          >
            Advanced
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', advancedOpen && 'rotate-180')} />
          </button>
          {advancedOpen && (
            <div className="flex flex-col gap-4 border-t border-border p-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium">Teamwork strategy</span>
                  <Button size="xs" variant="outline" onClick={suggestStrategy} disabled={suggesting}>
                    {suggesting ? <Spinner /> : <Sparkles />}
                    Suggest with AI
                  </Button>
                </div>
                <Select value={strategyId} onValueChange={(v) => typeof v === 'string' && applyStrategy(v)}>
                  <SelectTrigger className="w-full" aria-label="Teamwork strategy">
                    <SelectValue>
                      {(templates.data ?? []).find((t) => t.id === strategyId)?.name ?? 'None'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    <SelectItem value="">None</SelectItem>
                    {(templates.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {suggestedDifficulty && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    AI classified this task as <span className="font-medium">{suggestedDifficulty}</span> difficulty.
                  </p>
                )}
                <Textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="Cooperation instructions for the agent team (editable — prefilled by the strategy pick or AI suggestion)."
                  rows={4}
                  className="mt-2 font-mono text-xs"
                />
              </div>



              {(agentsQuery.data ?? []).length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <Bot className="size-4 text-purple-400" />
                      Codex Native Agents ({enabledAgents.length} selected)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(agentsQuery.data ?? []).map((agent) => {
                      const isChecked = enabledAgents.includes(agent.id);
                      return (
                        <label
                          key={agent.id}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs',
                            isChecked ? 'border-purple-500/60 bg-purple-500/5 text-foreground' : 'text-muted-foreground hover:bg-muted/50'
                          )}
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() =>
                              setEnabledAgents((prev) =>
                                prev.includes(agent.id) ? prev.filter((id) => id !== agent.id) : [...prev, agent.id]
                              )
                            }
                          />
                          <span className="font-mono">{agent.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}
        </section>

        {submitError && <p className="text-sm text-destructive-foreground">{submitError}</p>}

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FolderGit2 className="size-3.5" />
            {selectedRepos.length} repositor{selectedRepos.length === 1 ? 'y' : 'ies'} selected
          </p>
          <Button onClick={submit} disabled={!formValid || createWorkspace.isPending}>
            {createWorkspace.isPending ? <Spinner /> : null}
            {inPlace ? 'Start working' : 'Create workspace'}
          </Button>
        </div>
      </div>

      {/* MODAL: CREATE NEW CATEGORY / TRAIT */}
      <Dialog open={showCreateTagModal} onOpenChange={setShowCreateTagModal}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag size={16} className="text-primary" />
              <span>Create Category Tag</span>
            </DialogTitle>
            <DialogDescription>
              Tags bundle reusable skills, rules, and test verification commands for a domain.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Tag Name</label>
              <Input
                value={newTagName}
                onChange={(e) => {
                  setNewTagName(e.target.value);
                  if (!newTagId || newTagId === newTagName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)) {
                    setNewTagId(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30));
                  }
                }}
                placeholder="e.g. Invoicing & Billing"
                size="sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Tag ID / Slug</label>
              <Input
                value={newTagId}
                onChange={(e) => setNewTagId(e.target.value)}
                placeholder="e.g. billing"
                size="sm"
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Type</label>
              <select
                value={newTagType}
                onChange={(e) => setNewTagType(e.target.value as 'vertical' | 'trait')}
                className="w-full h-7.5 px-2 text-xs rounded-md border border-border bg-background text-foreground"
              >
                <option value="vertical">Vertical Subsystem</option>
                <option value="trait">Horizontal Trait</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Description (optional)</label>
              <Input
                value={newTagDescription}
                onChange={(e) => setNewTagDescription(e.target.value)}
                placeholder="What this domain covers..."
                size="sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Verification Command (optional)</label>
              <Input
                value={newTagVerifyCmd}
                onChange={(e) => setNewTagVerifyCmd(e.target.value)}
                placeholder="e.g. npm test -- billing"
                size="sm"
                className="font-mono"
              />
            </div>
          </DialogPanel>
          <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCreateTagModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!newTagName.trim() || !newTagId.trim() || savingNewTag}
              onClick={() => void handleCreateNewTag()}
            >
              {savingNewTag ? 'Creating...' : 'Create & Attach Tag'}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
