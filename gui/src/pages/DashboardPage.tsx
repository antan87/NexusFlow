import { useState, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderGit2,
  GitBranch,
  FileDiff,
  Boxes,
  Activity,
  Plus,
  ArrowRight,
  Terminal,
  Sparkles,
  Search,
  ExternalLink,
  Code2,
  Pi,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import { SiClaude, SiGithubcopilot } from 'react-icons/si';
import { AntigravityIcon } from '../components/icons/AntigravityIcon.js';
import type { Feature, HarnessDescription, WorkspaceStatus, WorkspaceLaunchTarget } from '../types.js';
import { Button } from '../components/ui/button.js';
import { StatusBadge } from '../components/ui/status-badge.js';
import { Spinner } from '../components/ui/spinner.js';
import { useAiDetect, useHarnesses, useWorkspaceLaunchTargets, useLaunchTerminal } from '../lib/api/queries.js';
import { apiFetch } from '../lib/api/client.js';
import { repoName } from '../lib/status.js';
import { useWorktreeNavigationState } from '../features/worktrees/worktreeStore.js';
import { WorkspaceChatResume } from '../features/chat/WorkspaceChatResume.js';

export interface HarnessOption {
  id: string;
  label: string;
  shortLabel: string;
  type: 'cli' | 'app' | 'editor';
  command?: string;
  targetId?: string;
  isAvailable: boolean;
  unavailableReason?: string;
  icon: ReactNode;
}

export interface HarnessConfig {
  id: string;
  name: string;
  shortName: string;
  cliCommand: string;
  icon: ReactNode;
  getOptions: (ctx: {
    aiDetected: Record<string, boolean>;
    launchTargets: WorkspaceLaunchTarget[];
  }) => HarnessOption[];
}

/**
 * Presentation for the launch targets a harness can open *besides* its CLI: a
 * desktop app, an IDE, an editor. Identity, name and CLI binary come from the
 * manifest — this used to be a hand-written registry, which is why a harness
 * added on the backend had no dashboard card until someone edited this file.
 */
interface ExtraTarget {
  targetId: string;
  label: string;
  shortLabel: string;
  type: 'app' | 'editor';
  unavailableReason: string;
  icon: ReactNode;
}

const HARNESS_PRESENTATION: Record<string, {
  name?: string;
  shortName: string;
  icon: ReactNode;
  extras: ExtraTarget[];
}> = {
  antigravity: {
    shortName: 'Antigravity',
    icon: <AntigravityIcon className="size-4" />,
    extras: [{
      targetId: 'antigravity', label: 'Antigravity IDE Workspace', shortLabel: 'IDE',
      type: 'editor', unavailableReason: 'Antigravity IDE not detected', icon: <Code2 size={12} />,
    }],
  },
  claude: {
    shortName: 'Claude',
    icon: (
      <span className="grid size-5 place-items-center rounded bg-[#D97757] text-white shadow-2xs">
        <SiClaude className="size-3" />
      </span>
    ),
    extras: [{
      targetId: 'claude-desktop', label: 'Claude Desktop App', shortLabel: 'App',
      type: 'app', unavailableReason: 'Claude Desktop not detected', icon: <ExternalLink size={12} />,
    }],
  },
  codex: {
    name: 'OpenAI Codex',
    shortName: 'Codex',
    icon: (
      <span className="grid size-5 place-items-center rounded bg-foreground text-background shadow-2xs">
        <BsOpenai className="size-3" />
      </span>
    ),
    extras: [{
      targetId: 'codex-desktop', label: 'Codex Desktop App', shortLabel: 'App',
      type: 'app', unavailableReason: 'Codex Desktop not detected', icon: <ExternalLink size={12} />,
    }],
  },
  copilot: {
    shortName: 'Copilot',
    icon: (
      <span className="grid size-5 place-items-center rounded bg-gradient-to-tr from-purple-600 via-indigo-500 to-blue-600 text-white shadow-2xs">
        <SiGithubcopilot className="size-3" />
      </span>
    ),
    extras: [{
      targetId: 'vscode', label: 'VS Code with Copilot', shortLabel: 'VS Code',
      type: 'editor', unavailableReason: 'VS Code not detected', icon: <Code2 size={12} />,
    }],
  },
  pi: {
    shortName: 'Pi',
    icon: <Pi className="size-4" />,
    extras: [],
  },
  grok: {
    shortName: 'Grok',
    icon: <span className="grid size-5 place-items-center rounded bg-foreground text-background font-bold text-[10px] shadow-2xs">G</span>,
    extras: [],
  },
};

/** One card per launchable harness, plus whatever extras it declares above. */
export function buildHarnesses(
  harnesses: HarnessDescription[],
  ctx: { aiDetected: Record<string, boolean>; launchTargets: WorkspaceLaunchTarget[] },
): HarnessConfig[] {
  return harnesses
    // A credential-only harness has no terminal to start, so a card would launch
    // nothing.
    .filter((harness) => harness.isLaunchable)
    .map((harness) => {
      const extra = HARNESS_PRESENTATION[harness.id] ?? { shortName: harness.label, icon: <Terminal size={12} />, extras: [] };
      const cli = harness.launchCommand ?? harness.id;
      return {
        id: harness.id,
        name: extra.name ?? harness.label,
        shortName: extra.shortName,
        cliCommand: cli,
        icon: extra.icon,
        getOptions: () => [
          {
            id: `${harness.id}-cli`,
            label: 'CLI in Terminal',
            shortLabel: 'CLI',
            type: 'cli' as const,
            command: cli,
            isAvailable: ctx.aiDetected[harness.id] ?? false,
            unavailableReason: `CLI "${cli}" not found on PATH`,
            icon: <Terminal size={12} />,
          },
          ...extra.extras.map((target) => ({
            ...target,
            id: `${harness.id}-${target.targetId}`,
            isAvailable: ctx.launchTargets.find((t) => t.id === target.targetId)?.available ?? false,
          })),
        ],
      } satisfies HarnessConfig;
    });
}

interface DashboardPageProps {
  workspaces: Feature[];
  workspaceStatuses: Record<string, WorkspaceStatus>;
  workspacesLoading?: boolean;
  checkedWorkspaceCount?: number;
  statusesComplete?: boolean;
  statusesError?: boolean;
  onRetryStatuses?: () => void;
  onOpenWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function DashboardPage({
  workspaces,
  workspaceStatuses,
  workspacesLoading = false,
  checkedWorkspaceCount = 0,
  statusesComplete = false,
  statusesError = false,
  onRetryStatuses,
  onOpenWorkspace,
  onNewWorkspace,
  showToast,
}: DashboardPageProps) {
  const aiDetect = useAiDetect();
  const harnesses = useHarnesses();
  const launchTargets = useWorkspaceLaunchTargets();
  const launchTerminalMutation = useLaunchTerminal();

  const [search, setSearch] = useState('');
  const [changesOnly, setChangesOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);
  const [launchWorkspace, setLaunchWorkspace] = useState('');
  const targetWorkspace = workspaces.find((w) => w.branchName === launchWorkspace) ?? workspaces[0];
  const visibleWorkspaces = workspaces.filter((w) =>
    `${w.name ?? ''} ${w.branchName} ${w.description ?? ''} ${w.repos.join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())
    && (!changesOnly || (workspaceStatuses[w.branchName]?.changedFiles ?? 0) > 0));
  const shownWorkspaces = visibleWorkspaces.slice(0, visibleCount);

  const [launchingKey, setLaunchingKey] = useState<string | null>(null);

  // Map AI Detected dictionary
  const aiDetectedMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    (aiDetect.data ?? []).forEach((d) => {
      map[d.name] = d.detected;
    });
    return map;
  }, [aiDetect.data]);

  const targetsList = useMemo(() => launchTargets.data ?? [], [launchTargets.data]);

  // Evaluated Harnesses with Options
  const evaluatedHarnesses = useMemo(() => {
    return buildHarnesses(harnesses.data ?? [], {
      aiDetected: aiDetectedMap,
      launchTargets: targetsList,
    }).map((harness) => {
      const allOptions = harness.getOptions({
        aiDetected: aiDetectedMap,
        launchTargets: targetsList,
      });
      const availableOptions = allOptions.filter((o) => o.isAvailable);
      const primaryOption = availableOptions[0] || allOptions[0];
      const isAnyAvailable = availableOptions.length > 0;

      // Status text
      let statusLabel = 'Not found';
      let statusTone: 'success' | 'neutral' | 'idle' = 'neutral';
      if (availableOptions.length > 1) {
        statusLabel = `${availableOptions.map((o) => o.shortLabel).join(' & ')} installed`;
        statusTone = 'success';
      } else if (availableOptions.length === 1) {
        statusLabel = `${availableOptions[0].shortLabel} installed`;
        statusTone = 'success';
      }

      return {
        harness,
        allOptions,
        availableOptions,
        primaryOption,
        isAnyAvailable,
        statusLabel,
        statusTone,
      };
    });
  }, [aiDetectedMap, targetsList]);

  const handleExecuteHarnessOption = async (harness: HarnessConfig, option: HarnessOption) => {
    if (launchingKey) return;
    const targetWs = targetWorkspace;
    if (!targetWs) {
      showToast?.('No active workspace available to launch harness in.', 'error');
      return;
    }

    const currentKey = `${harness.id}:${option.id}`;
    setLaunchingKey(currentKey);
    try {
      if (option.type === 'cli') {
        await launchTerminalMutation.mutateAsync({
          workspaceId: targetWs.branchName,
          assistant: harness.id,
          command: option.command,
        });
        showToast?.(`Opened ${harness.name} inside ContextSpace for ${targetWs.branchName}`, 'success');
      } else if (option.targetId) {
        await apiFetch(`/api/workspace/${encodeURIComponent(targetWs.branchName)}/launch`, {
          method: 'POST',
          body: JSON.stringify({ targetId: option.targetId }),
        });
        showToast?.(`Opened ${targetWs.branchName} in ${harness.name} (${option.label})`, 'success');
      }
    } catch (err: unknown) {
      showToast?.(`Failed to launch ${harness.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setLaunchingKey(null);
    }
  };

  const navigate = useNavigate();
  const { customTitles } = useWorktreeNavigationState();
  const statuses = workspaces.flatMap((ws) => workspaceStatuses[ws.branchName] ? [workspaceStatuses[ws.branchName]] : []);
  const changedFiles = statuses.reduce((total, status) => total + status.changedFiles, 0);
  const workspacesWithChanges = statuses.filter((status) => status.changedFiles > 0).length;
  const trackedRepos = new Set(workspaces.flatMap((ws) => ws.repos)).size;
  const readyAssistants = evaluatedHarnesses.filter((harness) => harness.isAnyAvailable).length;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-12 animate-fade-in">
      <header className="flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl border border-primary/15 bg-linear-to-r from-primary/10 via-card to-card px-5 py-4 shadow-xs">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            <Activity size={13} /> Current work
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Overview</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Pick up where you left off.</p>
        </div>
        <Button onClick={onNewWorkspace} size="sm" className="gap-1.5 shadow-sm">
          <Plus size={14} /> New workspace
        </Button>
      </header>

      <section aria-label="Overview totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Workspaces', value: workspacesLoading ? '—' : workspaces.length, icon: FolderGit2,
            accent: 'border-t-primary/70', iconStyle: 'bg-primary/10 text-primary' },
          { label: 'Review queue', value: statusesComplete && !workspacesLoading ? changedFiles : '—', icon: GitBranch,
            detail: statusesError ? 'Could not check workspace changes' : statusesComplete
              ? `${workspacesWithChanges} ${workspacesWithChanges === 1 ? 'workspace' : 'workspaces'} with diffs`
              : workspacesLoading ? 'Checking workspace changes…'
                : `Checking ${checkedWorkspaceCount} of ${workspaces.length} workspaces`,
            accent: 'border-t-amber-500/70', iconStyle: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
          { label: 'Tracked repos', value: workspacesLoading ? '—' : trackedRepos, icon: Boxes,
            accent: 'border-t-emerald-500/70', iconStyle: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
          { label: 'AI assistants', value: aiDetect.isLoading || launchTargets.isLoading || aiDetect.isError || launchTargets.isError
            ? '—' : readyAssistants, icon: Sparkles,
            accent: 'border-t-violet-500/70', iconStyle: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
        ].map(({ label, value, icon: Icon, detail, accent, iconStyle }) => {
          const content = (
            <>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium">{label}</span>
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${iconStyle}`}>
                  <Icon size={15} />
                </span>
              </div>
              <div className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${label === 'Review queue' && changedFiles > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}>
                {value}{label === 'Review queue' && typeof value === 'number' && <> <span className="text-[10px] font-normal text-muted-foreground">files</span></>}
              </div>
              {detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>}
            </>
          );
          return (
            <div key={label} role="group" aria-label={label}
              className={`rounded-xl border border-border border-t-2 bg-card px-3.5 py-3 shadow-xs transition-colors ${accent} ${label === 'Review queue' && changesOnly ? 'border-amber-500/60 bg-amber-500/5' : ''}`}>
              {label === 'Review queue' ? (
                <button type="button" className="w-full cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-75 disabled:cursor-default disabled:hover:opacity-100"
                  aria-label={statusesError ? 'Retry workspace changes' : changesOnly ? 'Show all workspaces' : 'Show workspaces with diffs'}
                  aria-pressed={changesOnly} disabled={!statusesError && (!statusesComplete || (!workspacesWithChanges && !changesOnly))}
                  onClick={() => {
                    if (statusesError) { onRetryStatuses?.(); return; }
                    setSearch(''); setVisibleCount(12); setChangesOnly(!changesOnly);
                  }}>
                  {content}
                </button>
              ) : content}
            </div>
          );
        })}
      </section>

      <section aria-labelledby="workspaces-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="workspaces-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
            {changesOnly ? 'Workspaces with diffs' : 'Active workspaces'} <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">{workspacesLoading ? '…' : changesOnly ? visibleWorkspaces.length : workspaces.length}</span>
          </h2>
          {workspaces.length > 3 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-muted-foreground" />
                <input
                  aria-label="Search workspaces"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setVisibleCount(12); }}
                  placeholder="Search workspaces"
                  className="h-8 w-44 rounded-md border border-input bg-card pl-8 pr-3 text-xs text-foreground outline-none focus:border-primary sm:w-56"
                />
              </div>
              <Button variant={changesOnly ? 'secondary' : 'ghost'} size="xs" className="h-8 text-xs"
                aria-pressed={changesOnly} disabled={!statusesComplete}
                onClick={() => { setVisibleCount(12); setChangesOnly(!changesOnly); }}>
                <GitBranch size={13} /> With changes
              </Button>
            </div>
          )}
        </div>

        {workspacesLoading ? (
          <div className="rounded-xl border border-border bg-card p-10">
            <Spinner aria-label="Loading workspaces" className="mx-auto size-5 text-primary" />
          </div>
        ) : !workspaces.length ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
            <FolderGit2 className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No workspaces yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Choose repositories and describe what you want to do.</p>
            <Button onClick={onNewWorkspace} size="sm" className="mt-4">
              <Plus size={14} /> Create workspace
            </Button>
          </div>
        ) : !visibleWorkspaces.length ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No workspaces match your filter.</p>
            <Button variant="ghost" size="xs" className="mt-2" onClick={() => { setSearch(''); setChangesOnly(false); setVisibleCount(12); }}>
              Clear filter
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
            {shownWorkspaces.map((ws) => {
              const status = workspaceStatuses[ws.branchName];
              const changedFiles = status?.changedFiles ?? 0;
              const title = customTitles[ws.branchName]?.title || ws.name || ws.description || ws.branchName;
              return (
                <article key={ws.id} className={`flex min-w-0 flex-col rounded-xl border border-border border-t-2 bg-card p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md ${changedFiles > 0 ? 'border-t-amber-500/70 hover:border-amber-500/50' : 'border-t-primary/45 hover:border-primary/40'}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <FolderGit2 size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-foreground" title={title}>{title}</h3>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={ws.branchName}>{ws.branchName}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground" title={ws.repos.map(repoName).join(', ')}>
                        {ws.repos.map(repoName).join(', ')}
                      </p>
                    </div>
                  </div>
                  {status && (
                    <div className={`mb-3 mt-3 flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${changedFiles > 0 ? 'border-amber-500/20 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-400' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}`}>
                      <span className={`size-1.5 shrink-0 rounded-full ${changedFiles > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      {changedFiles > 0 ? `${changedFiles} modified ${changedFiles === 1 ? 'file' : 'files'}` : 'Clean'}
                    </div>
                  )}
                  {!status && !statusesError && <p className="mb-3 mt-3 text-xs text-muted-foreground">Checking changes…</p>}
                  <div className="mt-auto min-w-0 border-t border-border pt-2">
                    <WorkspaceChatResume workspace={ws.branchName} />
                    <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
                      {changedFiles > 0 && (
                        <Button size="xs" onClick={() => navigate(`/workspaces/${encodeURIComponent(ws.branchName)}/changes`)} className="h-7 px-2">
                          <FileDiff size={13} /> Review diffs
                        </Button>
                      )}
                      <Button size="xs" variant="outline" onClick={() => onOpenWorkspace(ws.branchName)} className="h-7 px-3">
                        Open workspace <ArrowRight size={12} />
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
            </div>
            {visibleWorkspaces.length > visibleCount && (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" onClick={() => setVisibleCount((count) => count + 12)}>
                  Show more workspaces ({visibleWorkspaces.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      {workspaces.length > 0 && (
        <details className="border-t border-border pt-4">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Assistant launchers
          </summary>
          <div className="mt-4 max-w-xl">
        <aside className="rounded-xl border border-border bg-card p-4 shadow-xs" aria-labelledby="assistants-heading">
          <div className="mb-4">
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-primary mb-1">
              <Sparkles size={12} /> AI Launch Station
            </div>
            <h2 id="assistants-heading" className="text-sm font-bold tracking-tight text-foreground">
              External Coding Harnesses
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Launch agents directly into the target worktree.
            </p>
          </div>

          <label className="block text-[10px] font-mono uppercase font-bold text-muted-foreground mb-1.5" htmlFor="launch-workspace">
            Target Worktree
          </label>
          <select
            id="launch-workspace"
            value={targetWorkspace?.branchName ?? ''}
            onChange={(e) => setLaunchWorkspace(e.target.value)}
            disabled={!workspaces.length || !!launchingKey}
            className="mb-4 h-8 w-full rounded-md border border-input bg-secondary px-2 font-mono text-xs text-foreground focus-visible:outline-ring"
          >
            {!workspaces.length && <option value="">Create a workspace first</option>}
            {workspaces.map((w) => (
              <option key={w.id} value={w.branchName}>
                {customTitles[w.branchName]?.title || w.name ? `${customTitles[w.branchName]?.title || w.name} (${w.branchName})` : w.branchName}
              </option>
            ))}
          </select>

          <div className="divide-y divide-border/60">
            {evaluatedHarnesses.map(({ harness, availableOptions, isAnyAvailable, statusTone }) => (
              <div key={harness.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    {harness.icon}
                    <h3 className="text-xs font-semibold text-foreground">{harness.name}</h3>
                  </div>
                  <StatusBadge tone={statusTone}>
                    {aiDetect.isLoading || launchTargets.isLoading
                      ? 'Checking'
                      : aiDetect.isError || launchTargets.isError
                        ? 'Check failed'
                        : isAnyAvailable
                          ? 'Installed'
                          : 'Not detected'}
                  </StatusBadge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {availableOptions.map((option) => (
                    <Button
                      key={option.id}
                      variant="outline"
                      size="xs"
                      disabled={!!launchingKey || !targetWorkspace}
                      onClick={() => void handleExecuteHarnessOption(harness, option)}
                      title={`Launch ${harness.name} in ${targetWorkspace?.branchName ?? 'workspace'}`}
                      className="h-7 text-xs border-border hover:bg-accent cursor-pointer"
                    >
                      {launchingKey === `${harness.id}:${option.id}` ? (
                        <Spinner className="size-3" />
                      ) : (
                        option.icon
                      )}
                      {option.shortLabel}
                      <ArrowRight size={10} />
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
          </div>
        </details>
      )}
    </div>
  );
}
