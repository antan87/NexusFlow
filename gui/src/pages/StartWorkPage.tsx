import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronDown, CircleAlert, ExternalLink, FolderGit2, GitBranch, Sparkles, Zap } from 'lucide-react';

import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Textarea } from '../components/ui/textarea.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { Spinner } from '../components/ui/spinner.js';
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
  useConfig,
  useCreateWorkspace,
  useProjects,
  useRepoBranches,
  useRepos,
  useWorkflowTemplates,
  type CreateWorkspacePayload,
} from '../lib/api/queries.js';
import { ScaffoldRepoInline } from '../components/ScaffoldRepoInline.js';
import { useCreationStream, type CreationStep } from '../lib/api/useCreationStream.js';
import type { RepoInfo, WorkspaceMode } from '../types.js';

/** Sentinel select value for ad-hoc repo picking. */
const AD_HOC = '__ad-hoc__';

const isVsCode = new URLSearchParams(window.location.search).get('env') === 'vscode';

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
  const [searchParams] = useSearchParams();
  const projects = useProjects();
  const repos = useRepos();
  const aiDetect = useAiDetect();
  const templates = useWorkflowTemplates();
  const configQuery = useConfig();
  const config = configQuery.data?.config;
  const createWorkspace = useCreateWorkspace();
  const { progress, start } = useCreationStream();

  const [projectId, setProjectId] = useState<string>(searchParams.get('project') ?? AD_HOC);
  const [mode, setMode] = useState<WorkspaceMode>('in-place');
  const [branchName, setBranchName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [description, setDescription] = useState('');
  const [adHocPaths, setAdHocPaths] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [assistants, setAssistants] = useState<string[]>([]);
  const [strategyId, setStrategyId] = useState<string>('');
  /** Editable teamwork instructions; prefilled by strategy pick or AI suggestion. */
  const [customInstructions, setCustomInstructions] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedDifficulty, setSuggestedDifficulty] = useState<string | null>(null);

  /** Optional per-repo existing branch (keyed by repo PATH — names can repeat). */
  const [branchOverrides, setBranchOverrides] = useState<Record<string, string>>({});
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [openingEditor, setOpeningEditor] = useState(false);

  // Seed the assistant selection from detection exactly ONCE — a background
  // refetch must never overwrite a deliberately emptied selection.
  const assistantsSeededRef = useRef(false);
  useEffect(() => {
    if (!assistantsSeededRef.current && aiDetect.data) {
      assistantsSeededRef.current = true;
      setAssistants(aiDetect.data.filter((a) => a.detected).map((a) => a.name));
    }
  }, [aiDetect.data]);



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

  const submit = async () => {
    setSubmitError(null);
    const payload: CreateWorkspacePayload = {
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
      teamworkInstructions: customInstructions.trim() || undefined,
    };
    try {
      const { jobId } = await createWorkspace.mutateAsync(payload);
      start(jobId);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    }
  };

  // 'none' is a legacy persisted sentinel meaning "no editor configured".
  const defaultEditor = config?.defaultEditor && config.defaultEditor !== 'none' ? config.defaultEditor : null;

  const openInEditor = async () => {
    if (!progress.workspacePath) return;
    if (isVsCode) {
      window.parent.postMessage({ type: 'openWorkspaceFolder', workspacePath: progress.workspacePath }, '*');
      return;
    }
    if (!defaultEditor) return;
    setOpeningEditor(true);
    try {
      await apiFetch('/api/open-editor', {
        method: 'POST',
        body: JSON.stringify({ workspacePath: progress.workspacePath, command: defaultEditor }),
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningEditor(false);
    }
  };

  // ── Creation progress / result panel ─────────────────────────────────────
  if (progress.status !== 'idle') {
    const failedStep = progress.steps.find((s) => s.status === 'failed');
    const canOpenEditor = isVsCode || Boolean(defaultEditor);
    return (
      <div className="mx-auto max-w-xl animate-fade-in">
        <h1 className="text-xl font-semibold">
          {progress.status === 'running'
            ? 'Setting up your workspace…'
            : progress.status === 'completed'
              ? 'Workspace ready'
              : 'Workspace creation failed'}
        </h1>
        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-card px-4">
          {progress.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </ul>
        {progress.status === 'failed' && (
          <p className="mt-4 text-sm text-destructive-foreground">
            {failedStep?.message ?? progress.error ?? 'Something went wrong.'}
          </p>
        )}
        {progress.status === 'completed' && progress.workspacePath && (
          <p className="mt-4 truncate font-mono text-xs text-muted-foreground">{progress.workspacePath}</p>
        )}
        {submitError && <p className="mt-2 text-sm text-destructive-foreground">{submitError}</p>}
        <div className="mt-6 flex gap-2">
          {progress.status === 'completed' && progress.workspaceId && (
            <>
              <Button onClick={() => navigate(`/workspaces/${encodeURIComponent(progress.workspaceId!)}`)}>
                Open workspace
              </Button>
              {canOpenEditor && (
                <Button variant="outline" onClick={openInEditor} disabled={openingEditor}>
                  {openingEditor ? <Spinner /> : <ExternalLink />}
                  Open in editor
                </Button>
              )}
            </>
          )}
          {progress.status === 'failed' && (
            <Button variant="outline" onClick={() => window.location.reload()}>
              Start over
            </Button>
          )}
          {progress.status === 'running' && (
            <p className="text-sm text-muted-foreground">This can take a moment for large repositories.</p>
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
              />
              <ScaffoldRepoInline onCreated={(repo) => setAdHocPaths((prev) => [...prev, repo.path])} />
            </div>
          )}
          {(projects.data ?? []).length === 0 && !projects.isLoading && (
            <p className="mt-2 text-xs text-muted-foreground">
              Tip: <Link to="/projects" className="text-primary hover:underline">register a project</Link> to skip
              repo picking next time.
            </p>
          )}
        </section>

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
        </section>

        {/* 5. Advanced */}
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
                <span className="mb-1.5 block text-sm font-medium">AI assistants</span>
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
                      {assistant.displayName}
                    </label>
                  ))}
                </div>
              </div>

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
    </div>
  );
}
