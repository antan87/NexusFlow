import { useState, useMemo, type ReactNode } from 'react';
import {
  FolderGit2,
  GitBranch,
  Plus,
  ArrowRight,
  Terminal,
  Boxes,
  Sparkles,
  ExternalLink,
  Code2,
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
import { cn } from '../lib/utils.js';

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

export const HARNESS_REGISTRY: HarnessConfig[] = [
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
        isAvailable: aiDetected['antigravity'] ?? true,
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
        isAvailable: aiDetected['copilot'] ?? true,
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

  const [launchingKey, setLaunchingKey] = useState<string | null>(null);

  // Compute Telemetry Metrics
  const statuses = Object.values(workspaceStatuses);
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
        const existing = repoMap.get(name);
        if (existing) {
          existing.count += 1;
        } else {
          repoMap.set(name, { name, path: r, count: 1 });
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
    const targetWs = workspaces[0];
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
        showToast?.(`Launched ${harness.name} (${option.label}) for ${targetWs.branchName}`, 'success');
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

  return (
    <div className="mx-auto max-w-6xl animate-fade-in space-y-5 pb-10">
      {/* Top Header & Environment Pulse */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/70 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
              Environment Overview
            </h1>
            <StatusBadge tone="running" dot>
              Live Telemetry
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Multi-repo health, synchronized worktrees, and AI coding harnesses across your workspaces.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="default" onClick={onNewWorkspace}>
            <Plus size={14} /> Start work
          </Button>
        </div>
      </div>

      {/* Hero Metrics KPI Grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Metric 1: Workspaces */}
        <Card className="p-4 surface-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Workspaces
            </span>
            <span className="grid size-7 place-items-center rounded bg-primary/10 text-primary">
              <FolderGit2 size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="font-mono text-2xl font-bold text-foreground">
              {workspaces.length}
            </div>
            <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <span>{worktreeCount} worktrees</span>
              <span>•</span>
              <span>{inPlaceCount} in-place</span>
            </div>
          </div>
        </Card>

        {/* Metric 2: Git Changes */}
        <Card className="p-4 surface-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Git Activity
            </span>
            <span className={cn('grid size-7 place-items-center rounded', totalChangedFiles > 0 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400')}>
              <GitBranch size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className={cn('font-mono text-2xl font-bold', totalChangedFiles > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
              {totalChangedFiles} <span className="text-xs font-normal text-muted-foreground">files</span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              {workspacesWithChanges > 0
                ? `${workspacesWithChanges} workspace${workspacesWithChanges === 1 ? '' : 's'} with changes`
                : 'All workspaces clean'}
            </div>
          </div>
        </Card>

        {/* Metric 3: Monitored Repositories */}
        <Card className="p-4 surface-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Repositories
            </span>
            <span className="grid size-7 place-items-center rounded bg-primary/10 text-primary">
              <Boxes size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="font-mono text-2xl font-bold text-foreground">
              {repoStats.length} <span className="text-xs font-normal text-muted-foreground">repos</span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              {workspaces.length} active workspace{workspaces.length === 1 ? '' : 's'}
            </div>
          </div>
        </Card>

        {/* Metric 4: AI Coding Harnesses */}
        <Card className="p-4 surface-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              AI Harnesses
            </span>
            <span className="grid size-7 place-items-center rounded bg-primary/10 text-primary">
              <Sparkles size={15} />
            </span>
          </div>
          <div className="mt-2">
            <div className="font-mono text-2xl font-bold text-foreground">
              {evaluatedHarnesses.filter((h) => h.isAnyAvailable).length} / {evaluatedHarnesses.length}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
              <span>Antigravity</span>
              <span>•</span>
              <span>Claude</span>
              <span>•</span>
              <span>Codex</span>
            </div>
          </div>
        </Card>
      </div>

      {/* AI Assistants Launchpad & Ecosystem Status */}
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            AI Coding Assistant Hub
          </h2>
          <span className="text-[11px] text-muted-foreground font-mono">
            Direct CLI & Desktop launcher with dynamic environment detection
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {evaluatedHarnesses.map(({ harness, availableOptions, isAnyAvailable, statusTone }) => {
            const isBusy = Boolean(launchingKey && launchingKey.startsWith(`${harness.id}:`));

            return (
              <Card key={harness.id} className="p-4 surface-card flex flex-col justify-between gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {harness.icon}
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-foreground block">
                        {harness.name}
                      </span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        CLI command: {harness.cliCommand}
                      </span>
                    </div>
                  </div>
                  <StatusBadge tone={statusTone} dot={isAnyAvailable}>
                    {isAnyAvailable ? 'Ready' : 'Not installed'}
                  </StatusBadge>
                </div>

                {/* Direct Action Buttons for each detected harness mode */}
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50">
                  {!isAnyAvailable ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled
                      className="opacity-50 text-muted-foreground cursor-not-allowed"
                    >
                      Not Installed
                    </Button>
                  ) : (
                    availableOptions.map((opt) => {
                      const optBusy = launchingKey === `${harness.id}:${opt.id}`;
                      return (
                        <Button
                          key={opt.id}
                          size="xs"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => void handleExecuteHarnessOption(harness, opt)}
                          className="gap-1.5 font-medium"
                          title={`Launch ${harness.name} (${opt.label}) in active workspace`}
                        >
                          {optBusy ? <Spinner className="size-3" /> : opt.icon}
                          <span>{opt.label}</span>
                        </Button>
                      );
                    })
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Workspace Health & Divergence Matrix Table */}
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Workspace Divergence & Health Matrix
            </h2>
            <span className="rounded bg-muted px-1.5 py-0.2 font-mono text-[10px] text-foreground">
              {workspaces.length}
            </span>
          </div>
        </div>

        {workspacesLoading ? (
          <Card className="p-8 surface-card flex items-center justify-center">
            <Spinner className="size-5 text-primary" />
          </Card>
        ) : workspaces.length === 0 ? (
          <Card className="border-dashed surface-card">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderGit2 />
                </EmptyMedia>
                <EmptyTitle>No active workspaces</EmptyTitle>
                <EmptyDescription>
                  Start your first multi-repo workspace to automatically branch worktrees and prepare AI contexts.
                </EmptyDescription>
              </EmptyHeader>
              <Button onClick={onNewWorkspace}>
                <Plus size={15} /> Start work
              </Button>
            </Empty>
          </Card>
        ) : (
          <Card className="divide-y divide-border/60 overflow-hidden surface-card">
            {/* Table Header */}
            <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-mono">
              <span className="col-span-4">Workspace / Branch</span>
              <span className="col-span-2">AI Harness</span>
              <span className="col-span-2">Git Status</span>
              <span className="col-span-2">Services</span>
              <span className="col-span-2 text-right">Action</span>
            </div>

            {/* Table Rows */}
            {workspaces.map((ws) => {
              const st = workspaceStatuses[ws.branchName];
              const hasChanges = Boolean(st && st.changedFiles > 0);
              const hasServices = Boolean(st && st.runningServices > 0);
              const sync = (ws.mode ?? 'worktree') === 'in-place' ? null : (st ? syncMeta(st.syncStatus) : null);

              return (
                <div
                  key={ws.id}
                  onClick={() => onOpenWorkspace(ws.branchName)}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 px-4 py-3 items-center hover:bg-accent/40 transition-colors cursor-pointer text-xs"
                >
                  {/* Branch & Mode */}
                  <div className="sm:col-span-4 min-w-0 flex items-center gap-2">
                    <span
                      className={cn(
                        'size-2 rounded-full shrink-0',
                        hasChanges ? 'bg-amber-400' : 'bg-emerald-500'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate font-mono font-bold text-foreground" title={ws.branchName}>
                          {ws.branchName}
                        </span>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground bg-muted px-1 rounded shrink-0">
                          {ws.mode === 'in-place' ? 'In-place' : 'Worktree'}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                        {ws.repos.length} {ws.repos.length === 1 ? 'repo' : 'repos'} • {new Date(ws.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  {/* Configured AI Assistants */}
                  <div className="sm:col-span-2 flex items-center gap-1.5 min-w-0">
                    {ws.assistants && ws.assistants.length > 0 ? (
                      ws.assistants.map((ast) => (
                        <span key={ast} className="inline-flex items-center" title={`Configured AI: ${ast}`}>
                          {ast === 'antigravity' ? (
                            <AntigravityIcon className="size-3.5" />
                          ) : ast === 'claude' ? (
                            <span className="grid size-3.5 place-items-center rounded bg-[#D97757] text-white shadow-2xs">
                              <SiClaude className="size-2" />
                            </span>
                          ) : ast === 'codex' ? (
                            <span className="grid size-3.5 place-items-center rounded bg-foreground text-background shadow-2xs">
                              <BsOpenai className="size-2" />
                            </span>
                          ) : (
                            <span className="grid size-3.5 place-items-center rounded bg-blue-600 text-white shadow-2xs">
                              <SiGithubcopilot className="size-2" />
                            </span>
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-muted-foreground font-mono">—</span>
                    )}
                  </div>

                  {/* Git Health */}
                  <div className="sm:col-span-2 font-mono text-[11px]">
                    {hasChanges ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        {st!.changedFiles} modified
                        {sync && sync.tone !== 'idle' && (
                          <span className="text-[10px] text-muted-foreground ml-0.5 font-normal">({sync.label})</span>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Clean
                      </span>
                    )}
                  </div>

                  {/* Services & Sync */}
                  <div className="sm:col-span-2 font-mono text-[11px]">
                    {hasServices ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        {st!.runningServices} active
                      </span>
                    ) : (
                      <span className="text-muted-foreground/70">Offline</span>
                    )}
                  </div>

                  {/* Fast Action */}
                  <div className="sm:col-span-2 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onOpenWorkspace(ws.branchName)}
                      className="gap-1 text-primary hover:text-primary"
                    >
                      <span>Inspect</span>
                      <ArrowRight size={12} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </div>

      {/* Multi-Repo Composition Breakdown */}
      {repoStats.length > 0 && (
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Repository Worktree Allocations ({repoStats.length})
            </h2>
            <span className="text-[11px] text-muted-foreground font-mono">
              Underlying git repos mapped across features
            </span>
          </div>

          <Card className="divide-y divide-border/60 overflow-hidden surface-card">
            {repoStats.map((repo) => (
              <div key={repo.name} className="flex items-center justify-between p-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0 font-mono">
                  <span className="grid size-6 place-items-center rounded bg-muted/60 text-muted-foreground">
                    <Boxes size={13} />
                  </span>
                  <div className="min-w-0">
                    <span className="font-bold text-foreground block truncate">{repo.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate block">{repo.path}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 font-mono text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted px-2 py-0.5 text-foreground font-semibold">
                    {repo.count} {repo.count === 1 ? 'workspace worktree' : 'workspace worktrees'}
                  </span>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
