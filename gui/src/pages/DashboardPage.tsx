import { useState, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderGit2,
  GitBranch,
  Plus,
  ArrowRight,
  Terminal,
  Boxes,
  Sparkles,
  Search,
  ExternalLink,
  Code2,
  FileDiff,
  Activity,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import { SiClaude, SiGithubcopilot } from 'react-icons/si';
import { AntigravityIcon } from '../components/icons/AntigravityIcon.js';
import type { Feature, WorkspaceStatus, WorkspaceLaunchTarget } from '../types.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { StatusBadge } from '../components/ui/status-badge.js';
import { Spinner } from '../components/ui/spinner.js';
import { useAiDetect, useWorkspaceLaunchTargets, useLaunchTerminal } from '../lib/api/queries.js';
import { apiFetch } from '../lib/api/client.js';
import { repoName, syncMeta } from '../lib/status.js';
import { BRAND_NAME } from '../brand.js';
import { useWorktreeNavigationState } from '../features/worktrees/worktreeStore.js';
import { cn } from '../lib/utils.js';
import { useFloatingChat } from '../features/chat/floatingChatStore.js';

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

const HARNESS_REGISTRY: HarnessConfig[] = [
  {
    id: 'antigravity',
    name: 'Google Antigravity',
    shortName: 'Antigravity',
    cliCommand: 'agy',
    icon: <AntigravityIcon className="size-4" />,
    getOptions: ({ aiDetected, launchTargets }) => [
      {
        id: 'antigravity-cli',
        label: 'CLI in Terminal',
        shortLabel: 'CLI',
        type: 'cli',
        command: 'agy',
        isAvailable: aiDetected['antigravity'] ?? false,
        unavailableReason: 'CLI "agy" not found on PATH',
        icon: <Terminal size={12} />,
      },
      {
        id: 'antigravity-ide',
        label: 'Antigravity IDE Workspace',
        shortLabel: 'IDE',
        type: 'editor',
        targetId: 'antigravity',
        isAvailable: launchTargets.find((t) => t.id === 'antigravity')?.available ?? false,
        unavailableReason: 'Antigravity IDE not installed',
        icon: <Code2 size={12} />,
      },
    ],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    shortName: 'Claude',
    cliCommand: 'claude',
    icon: (
      <span className="grid size-5 place-items-center rounded bg-[#D97757] text-white shadow-2xs">
        <SiClaude className="size-3" />
      </span>
    ),
    getOptions: ({ aiDetected, launchTargets }) => [
      {
        id: 'claude-cli',
        label: 'CLI in Terminal',
        shortLabel: 'CLI',
        type: 'cli',
        command: 'claude',
        isAvailable: aiDetected['claude'] ?? false,
        unavailableReason: 'CLI "claude" not found on PATH',
        icon: <Terminal size={12} />,
      },
      {
        id: 'claude-desktop',
        label: 'Claude Desktop App',
        shortLabel: 'App',
        type: 'app',
        targetId: 'claude-desktop',
        isAvailable: launchTargets.find((t) => t.id === 'claude-desktop')?.available ?? false,
        unavailableReason: 'Claude Desktop not detected',
        icon: <ExternalLink size={12} />,
      },
    ],
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    shortName: 'Codex',
    cliCommand: 'codex',
    icon: (
      <span className="grid size-5 place-items-center rounded bg-foreground text-background shadow-2xs">
        <BsOpenai className="size-3" />
      </span>
    ),
    getOptions: ({ aiDetected, launchTargets }) => [
      {
        id: 'codex-cli',
        label: 'CLI in Terminal',
        shortLabel: 'CLI',
        type: 'cli',
        command: 'codex',
        isAvailable: aiDetected['codex'] ?? false,
        unavailableReason: 'CLI "codex" not found on PATH',
        icon: <Terminal size={12} />,
      },
      {
        id: 'codex-desktop',
        label: 'Codex Desktop App',
        shortLabel: 'App',
        type: 'app',
        targetId: 'codex-desktop',
        isAvailable: launchTargets.find((t) => t.id === 'codex-desktop')?.available ?? false,
        unavailableReason: 'Codex Desktop not detected',
        icon: <ExternalLink size={12} />,
      },
    ],
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    shortName: 'Copilot',
    cliCommand: 'copilot',
    icon: (
      <span className="grid size-5 place-items-center rounded bg-gradient-to-tr from-purple-600 via-indigo-500 to-blue-600 text-white shadow-2xs">
        <SiGithubcopilot className="size-3" />
      </span>
    ),
    getOptions: ({ aiDetected, launchTargets }) => [
      {
        id: 'copilot-cli',
        label: 'Copilot CLI in Terminal',
        shortLabel: 'CLI',
        type: 'cli',
        command: 'copilot',
        isAvailable: aiDetected['copilot'] ?? false,
        icon: <Terminal size={12} />,
      },
      {
        id: 'copilot-vscode',
        label: 'VS Code with Copilot',
        shortLabel: 'VS Code',
        type: 'editor',
        targetId: 'vscode',
        isAvailable: launchTargets.find((t) => t.id === 'vscode')?.available ?? false,
        unavailableReason: 'VS Code not detected',
        icon: <Code2 size={12} />,
      },
    ],
  },
];

interface DashboardPageProps {
  workspaces: Feature[];
  workspaceStatuses: Record<string, WorkspaceStatus>;
  workspacesLoading?: boolean;
  onOpenWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function DashboardPage({
  workspaces,
  workspaceStatuses,
  workspacesLoading = false,
  onOpenWorkspace,
  onNewWorkspace,
  showToast,
}: DashboardPageProps) {
  const aiDetect = useAiDetect();
  const launchTargets = useWorkspaceLaunchTargets();
  const launchTerminalMutation = useLaunchTerminal();
  const { openCli } = useFloatingChat();

  const [search, setSearch] = useState('');
  const [changesOnly, setChangesOnly] = useState(false);
  const [launchWorkspace, setLaunchWorkspace] = useState('');
  const targetWorkspace = workspaces.find((w) => w.branchName === launchWorkspace) ?? workspaces[0];
  const visibleWorkspaces = workspaces.filter((w) =>
    `${w.branchName} ${w.description ?? ''} ${w.repos.join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())
    && (!changesOnly || (workspaceStatuses[w.branchName]?.changedFiles ?? 0) > 0));

  const [launchingKey, setLaunchingKey] = useState<string | null>(null);

  // Compute Telemetry Metrics
  const statuses = workspaces.flatMap((w) => workspaceStatuses[w.branchName] ? [workspaceStatuses[w.branchName]] : []);
  const totalChangedFiles = statuses.reduce((sum, s) => sum + (s.changedFiles || 0), 0);
  const workspacesWithChanges = statuses.filter((s) => s.changedFiles > 0).length;
  const worktreeCount = workspaces.filter((w) => (w.mode ?? 'worktree') === 'worktree').length;
  const inPlaceCount = workspaces.filter((w) => w.mode === 'in-place').length;

  // Aggregate Unique Parent Repositories
  const repoStats = useMemo(() => {
    const repoMap = new Map<string, { name: string; path: string; count: number }>();
    workspaces.forEach((w) => {
      (w.repos || []).forEach((r) => {
        const name = repoName(r);
        const existing = repoMap.get(r);
        if (existing) {
          existing.count += 1;
        } else {
          repoMap.set(r, { name, path: r, count: 1 });
        }
      });
    });
    return Array.from(repoMap.values());
  }, [workspaces]);

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
    return HARNESS_REGISTRY.map((harness) => {
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
        statusLabel = `${availableOptions.map((o) => o.shortLabel).join(' & ')} Ready`;
        statusTone = 'success';
      } else if (availableOptions.length === 1) {
        statusLabel = `${availableOptions[0].shortLabel} Ready`;
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

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12 animate-fade-in">
      {/* ─── Minimalist Cockpit Header ────────────────────────────────────────── */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-1">
            <Activity size={14} className="text-primary" />
            <span>{BRAND_NAME}</span>
            <span className="opacity-40">/</span>
            <span className="text-foreground font-semibold">Cockpit Overview</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Multi-Worktree Process &amp; Review Station
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={onNewWorkspace}
            size="sm"
            className="h-8 gap-1.5 px-3.5 bg-primary text-primary-foreground font-semibold hover:bg-primary/90 shadow-xs cursor-pointer text-xs"
          >
            <Plus size={14} /> New Worktree
          </Button>
        </div>
      </header>

      {/* ─── Telemetry Ribbon (High-Density Micro-Cards) ───────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: 'Active Worktrees',
            value: workspacesLoading ? '—' : workspaces.length,
            detail: `${worktreeCount} isolated · ${inPlaceCount} host`,
            icon: FolderGit2,
          },
          {
            label: 'Review Queue',
            value: statuses.length ? totalChangedFiles : '—',
            detail: `${workspacesWithChanges} worktrees with diffs`,
            icon: GitBranch,
            isDirty: totalChangedFiles > 0,
          },
          {
            label: 'Tracked Repos',
            value: workspacesLoading ? '—' : repoStats.length,
            detail: 'Connected on local host',
            icon: Boxes,
          },
          {
            label: 'AI Assistants',
            value: aiDetect.isLoading || launchTargets.isLoading ? '—' : evaluatedHarnesses.filter((h) => h.isAnyAvailable).length,
            detail: 'Antigravity, Claude, Codex',
            icon: Sparkles,
          },
        ].map(({ label, value, detail, icon: Icon, isDirty }) => (
          <Card key={label} className="bg-card border border-border p-3.5 rounded-xl shadow-xs transition-colors hover:border-border/80">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-medium">{label}</span>
              <Icon size={14} className={isDirty ? 'text-amber-400' : 'text-primary'} />
            </div>
            <div className={cn(
              'my-1.5 text-2xl font-bold tracking-tight tabular-nums',
              isDirty ? 'text-amber-400' : 'text-foreground'
            )}>
              {value}
            </div>
            <p className="text-[11px] text-muted-foreground font-mono">{detail}</p>
          </Card>
        ))}
      </div>

      {/* ─── Main Grid: Worktree Matrix & Assistant Dock ───────────────────────── */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Left Column: Workspaces & Branch Worktrees */}
        <section className="min-w-0" aria-labelledby="workspaces-heading">
          {/* Controls Strip: Search & Filter Pills */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span id="workspaces-heading" className="text-sm font-bold text-foreground">
                Workspaces ({visibleWorkspaces.length})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
                <input
                  aria-label="Search workspaces"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter worktrees or repos…"
                  className="h-8 w-48 sm:w-64 rounded-lg border border-input bg-card pl-8 pr-3 text-xs outline-none focus:border-primary transition-colors text-foreground"
                />
              </div>
              <Button
                variant={changesOnly ? 'secondary' : 'outline'}
                size="xs"
                className="h-8 rounded-lg text-xs font-medium cursor-pointer"
                aria-pressed={changesOnly}
                onClick={() => setChangesOnly(!changesOnly)}
              >
                <GitBranch size={13} /> Diffs only
              </Button>
            </div>
          </div>

          {/* Worktree Cards List */}
          {workspacesLoading ? (
            <Card className="p-10 border border-border bg-card">
              <Spinner aria-label="Loading workspaces" className="mx-auto size-5 text-primary" />
            </Card>
          ) : !workspaces.length ? (
            <Card className="rounded-xl border border-dashed border-border bg-card/50 p-8">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><FolderGit2 /></EmptyMedia>
                  <EmptyTitle>No active worktrees</EmptyTitle>
                  <EmptyDescription>Create a worktree to start working on isolated features with dynamic plan steps.</EmptyDescription>
                </EmptyHeader>
                <Button onClick={onNewWorkspace} className="mt-4 bg-primary text-primary-foreground">
                  <Plus size={14} /> Create First Worktree
                </Button>
              </Empty>
            </Card>
          ) : !visibleWorkspaces.length ? (
            <Card className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-xs text-muted-foreground">No worktrees match your filter.</p>
              <Button variant="ghost" size="xs" className="mt-2" onClick={() => { setSearch(''); setChangesOnly(false); }}>
                Clear filter
              </Button>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleWorkspaces.map((ws) => {
                const status = workspaceStatuses[ws.branchName];
                const sync = ws.mode === 'in-place' || !status ? null : syncMeta(status.syncStatus);
                const hasChanges = (status?.changedFiles ?? 0) > 0;
                const humanTitle = customTitles[ws.branchName]?.title || ws.description || ws.branchName;
                const isCustomTitle = Boolean(customTitles[ws.branchName]?.title);

                return (
                  <div
                    key={ws.id}
                    className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/50 flex flex-col justify-between gap-3 shadow-xs"
                  >
                    {/* Top Row: Title & Badges */}
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0 flex-1">
                          <h3
                            className="font-bold text-sm text-foreground truncate cursor-pointer hover:text-primary transition-colors"
                            onClick={() => onOpenWorkspace(ws.branchName)}
                            title={humanTitle}
                          >
                            {humanTitle}
                          </h3>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider border',
                            ws.mode === 'in-place'
                              ? 'border-border bg-secondary text-muted-foreground'
                              : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                          )}
                        >
                          {ws.mode === 'in-place' ? 'in-place' : 'isolated'}
                        </span>
                      </div>

                      {/* Technical Branch Telemetry */}
                      <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground truncate mb-2">
                        <GitBranch size={12} className="text-primary shrink-0" />
                        <span className="truncate font-semibold text-foreground/80">{ws.branchName}</span>
                        {isCustomTitle && ws.description && (
                          <span className="text-[10px] text-muted-foreground/70 truncate">({ws.description})</span>
                        )}
                      </div>

                      {/* Repos Connected */}
                      <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                        {ws.repos.map((r) => (
                          <span
                            key={r}
                            className="rounded border border-border/60 bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            {repoName(r)}
                          </span>
                        ))}
                      </div>

                      {/* Status & Review Diff Indicator */}
                      <div className="flex items-center gap-2 text-xs font-mono">
                        {hasChanges ? (
                          <span className="flex items-center gap-1.5 text-amber-400 font-semibold">
                            <span className="size-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                            {status?.changedFiles} modified files
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                            <span className="size-1.5 rounded-full bg-emerald-400 shrink-0" />
                            Clean worktree
                          </span>
                        )}
                        {sync && (
                          <span className="text-muted-foreground text-[10px]">• {sync.label}</span>
                        )}
                      </div>
                    </div>

                    {/* Bottom Row: Actions */}
                    <div className="border-t border-border/70 pt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => openCli(ws.branchName)}
                          className="h-7 gap-1 px-2.5 text-xs font-semibold cursor-pointer"
                          aria-label={`Open CLI chat for ${ws.branchName}`}
                        >
                          <Terminal size={12} /> CLI chat
                        </Button>
                        {hasChanges && (
                          <Button
                            size="xs"
                            onClick={() => navigate(`/workspaces/${encodeURIComponent(ws.branchName)}/changes`)}
                            className="h-7 gap-1 px-2.5 bg-primary text-primary-foreground font-semibold text-xs hover:bg-primary/90 cursor-pointer"
                            title="Open Monaco Diff Review"
                          >
                            <FileDiff size={12} /> Review Diffs
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => onOpenWorkspace(ws.branchName)}
                          className="h-7 text-xs border-border hover:bg-accent cursor-pointer"
                        >
                          Cockpit
                        </Button>
                      </div>

                      <button
                        type="button"
                        onClick={() => navigate(`/workspaces/${encodeURIComponent(ws.branchName)}/plan`)}
                        className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        Plan <ArrowRight size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right Column: AI Assistant Station */}
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
                {customTitles[w.branchName]?.title ? `${customTitles[w.branchName]?.title} (${w.branchName})` : w.branchName}
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
                          ? 'Ready'
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

      {/* Connected Repositories Footer Bar */}
      {repoStats.length > 0 && (
        <section className="border-t border-border pt-4">
          <div className="mb-2.5 flex items-center gap-2 text-xs font-mono font-medium text-muted-foreground">
            <Boxes size={13} className="text-primary" /> Tracked Repositories
          </div>
          <div className="flex flex-wrap gap-2">
            {repoStats.map((repo) => (
              <button
                key={repo.path}
                type="button"
                onClick={() => {
                  setSearch(repo.path);
                  setChangesOnly(false);
                }}
                title={repo.path}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-xs transition-colors hover:border-primary/50 text-foreground cursor-pointer"
              >
                <FolderGit2 size={12} className="text-primary" />
                <span>{repo.name}</span>
                <span className="rounded bg-secondary px-1.5 py-0.2 text-[10px] text-muted-foreground">
                  {repo.count} {repo.count === 1 ? 'worktree' : 'worktrees'}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
