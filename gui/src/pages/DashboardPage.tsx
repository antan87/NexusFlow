import { useState, useMemo, type ReactNode } from 'react';
import {
  FolderGit2,
  GitBranch,
  Plus,
  ArrowRight,
  Terminal,
  Boxes,
  Sparkles,
  Search,
  Layers3,
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
import { BRAND_NAME } from '../brand.js';
import { ContextSpaceIcon } from '../components/icons/ContextSpaceIcon.js';

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
    <div className="context-home mx-auto max-w-7xl space-y-7 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Layers3 size={15} /><span>{BRAND_NAME}</span><span className="opacity-40">/</span><span className="text-foreground">Overview</span></div>
        <span className="text-xs text-muted-foreground">Your next idea starts here.</span>
      </header>

      <section className="context-hero relative overflow-hidden rounded-2xl border border-border p-6 sm:p-9 lg:p-11">
        <div className="relative z-10 max-w-2xl">
          <div className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary"><ContextSpaceIcon size={23} /> A space for what’s next</div>
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-[-0.055em] sm:text-5xl lg:text-6xl">Many repositories.<br /><span className="context-hero-accent">One clear direction.</span></h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">Bring your code, context, and AI assistants together. Pick up a workspace, follow an idea, and make your next move.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button onClick={onNewWorkspace} className="h-10 rounded-lg px-5"><Plus size={16} /> Start work <ArrowRight size={15} /></Button>
            {targetWorkspace && <Button variant="outline" className="h-10 max-w-full rounded-lg" onClick={() => onOpenWorkspace(targetWorkspace.branchName)}><span className="truncate">Open {targetWorkspace.branchName}</span><ArrowRight size={14} /></Button>}
          </div>
        </div>
        <div className="context-hero-signature pointer-events-none absolute right-10 top-1/2 hidden -translate-y-1/2 opacity-20 xl:block" aria-hidden="true"><ContextSpaceIcon size={220} /></div>
        <div className="relative mt-9 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"><span>Isolated workspaces</span><span>Shared knowledge</span><span>Your choice of AI</span></div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Workspaces', value: workspacesLoading ? '—' : workspaces.length, detail: `${worktreeCount} worktrees · ${inPlaceCount} in-place`, icon: Layers3 },
          { label: 'Connected repositories', value: workspacesLoading ? '—' : repoStats.length, detail: 'Across your workspaces', icon: FolderGit2 },
          { label: 'Changed files', value: statuses.length ? totalChangedFiles : '—', detail: `${workspacesWithChanges} workspaces with changes`, icon: GitBranch },
          { label: 'Available assistants', value: aiDetect.isLoading || launchTargets.isLoading ? '—' : evaluatedHarnesses.filter((h) => h.isAnyAvailable).length, detail: 'Choose how you work', icon: Sparkles },
        ].map(({ label, value, detail, icon: Icon }) => <Card key={label} className="context-metric gap-0 rounded-xl p-4 sm:p-5"><div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{label}</span><Icon size={15} className="text-primary" /></div><div className="my-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</div><p className="text-[11px] text-muted-foreground">{detail}</p></Card>)}
      </div>

      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_310px]">
        <section className="min-w-0" aria-labelledby="workspaces-heading">
          <div className="mb-4 flex items-center justify-between gap-3"><div><h2 id="workspaces-heading" className="text-lg font-semibold tracking-tight">Your workspaces</h2><p className="mt-1 text-xs text-muted-foreground">A little context. A lot of possibility.</p></div><Button variant="ghost" size="sm" onClick={onNewWorkspace}><Plus size={14} /> New</Button></div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-input bg-card px-3"><Search size={15} className="shrink-0 text-muted-foreground" /><input aria-label="Search workspaces" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a workspace or repository…" className="h-10 w-full min-w-0 bg-transparent text-xs outline-none" /></label>
            <Button variant={changesOnly ? 'secondary' : 'outline'} className="h-10 rounded-lg" aria-pressed={changesOnly} onClick={() => setChangesOnly(!changesOnly)}><GitBranch size={14} /> With changes</Button>
          </div>
          {workspacesLoading ? <Card className="p-10"><Spinner aria-label="Loading workspaces" className="mx-auto size-5" /></Card> : !workspaces.length ? <Card className="rounded-xl border-dashed"><Empty><EmptyHeader><EmptyMedia variant="icon"><FolderGit2 /></EmptyMedia><EmptyTitle>Make room for your next idea</EmptyTitle><EmptyDescription>Create a workspace to bring repositories and assistant context together.</EmptyDescription></EmptyHeader><Button onClick={onNewWorkspace}><Plus size={15} /> Create your first workspace</Button></Empty></Card> : !visibleWorkspaces.length ? <Card className="rounded-xl p-8 text-center"><p className="text-sm">No workspaces match this view.</p><Button variant="ghost" className="mt-3" onClick={() => { setSearch(''); setChangesOnly(false); }}>Clear filters</Button></Card> : <div className="space-y-3">{visibleWorkspaces.map((ws) => {
            const status = workspaceStatuses[ws.branchName];
            const sync = ws.mode === 'in-place' || !status ? null : syncMeta(status.syncStatus);
            return <button key={ws.id} type="button" onClick={() => onOpenWorkspace(ws.branchName)} className="context-workspace group w-full rounded-xl border border-border bg-card p-5 text-left transition duration-200 hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-primary/5 text-primary"><FolderGit2 size={19} /></span><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{ws.branchName}</h3><span className="text-[10px] text-muted-foreground">{ws.mode === 'in-place' ? 'In-place workspace' : 'Isolated worktree'}</span></div></div><ArrowRight size={17} className="mt-2 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" /></div>
              {ws.description && <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{ws.description}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">{ws.repos.map((r) => <span key={r} className="rounded-md bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">{repoName(r)}</span>)}</div>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground"><span className={status?.changedFiles ? 'text-warning-foreground' : ''}>{!status ? 'Status pending' : status.changedFiles ? `${status.changedFiles} changed files` : 'Working tree clean'}</span>{sync && <span>{sync.label}</span>}{!!status?.runningServices && <span className="text-success-foreground">{status.runningServices} services running</span>}<span className="ml-auto">Open workspace</span></div>
            </button>;
          })}</div>}
        </section>

        <aside className="rounded-xl border border-border bg-card p-5" aria-labelledby="assistants-heading">
          <div className="mb-5"><div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary"><Sparkles size={14} /> Ready when you are</div><h2 id="assistants-heading" className="text-lg font-semibold tracking-tight">Your AI, your way.</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Launch an assistant with the right workspace already in place.</p></div>
          <label className="block text-[11px] font-medium text-muted-foreground" htmlFor="launch-workspace">Launch into</label>
          <select id="launch-workspace" value={targetWorkspace?.branchName ?? ''} onChange={(e) => setLaunchWorkspace(e.target.value)} disabled={!workspaces.length || !!launchingKey} className="mt-2 mb-5 h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-ring">{!workspaces.length && <option value="">Create a workspace first</option>}{workspaces.map((w) => <option key={w.id} value={w.branchName}>{w.branchName}</option>)}</select>
          <div className="divide-y divide-border">{evaluatedHarnesses.map(({ harness, availableOptions, isAnyAvailable, statusTone }) => <div key={harness.id} className="py-4 first:pt-0 last:pb-0"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2.5">{harness.icon}<h3 className="text-xs font-semibold">{harness.shortName}</h3></div><StatusBadge tone={statusTone}>{aiDetect.isLoading || launchTargets.isLoading ? 'Checking' : aiDetect.isError || launchTargets.isError ? 'Check failed' : isAnyAvailable ? 'Available' : 'Not detected'}</StatusBadge></div><div className="mt-3 flex flex-wrap gap-2">{availableOptions.map((option) => <Button key={option.id} variant="outline" size="xs" disabled={!!launchingKey || !targetWorkspace} onClick={() => void handleExecuteHarnessOption(harness, option)} title={`Open ${harness.name} in ${targetWorkspace?.branchName ?? 'a workspace'}`}>{launchingKey === `${harness.id}:${option.id}` ? <Spinner className="size-3" /> : option.icon}{option.shortLabel}<ArrowRight size={11} /></Button>)}</div></div>)}</div>
        </aside>
      </div>
      {repoStats.length > 0 && <section className="border-t border-border pt-5"><div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Boxes size={14} /> Connected repositories</div><div className="flex flex-wrap gap-2">{repoStats.map((repo) => <button key={repo.path} onClick={() => { setSearch(repo.path); setChangesOnly(false); document.getElementById('workspaces-heading')?.scrollIntoView({ block: 'start' }); }} title={repo.path} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs transition-colors hover:border-primary/50 focus-visible:outline-ring"><FolderGit2 size={13} className="text-primary" />{repo.name}<span className="text-muted-foreground">{repo.count}</span></button>)}</div></section>}
    </div>
  );
}
