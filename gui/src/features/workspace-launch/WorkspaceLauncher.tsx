import { useRef, useState } from 'react';
import {
  AppWindow,
  Code2,
  Copy,
  ExternalLink,
  Orbit,
  RefreshCw,
  Rocket,
  Terminal,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import {
  SiClaude,
  SiCursor,
  SiIntellijidea,
  SiPycharm,
  SiSublimetext,
  SiWebstorm,
  SiWindsurf,
  SiZedindustries,
} from 'react-icons/si';
import { VscVscode, VscVscodeInsiders } from 'react-icons/vsc';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '../../components/ui/dialog.js';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../../components/ui/empty.js';
import { Spinner } from '../../components/ui/spinner.js';
import { apiFetch } from '../../lib/api/client.js';
import { useWorkspaceLaunchTargets, useWorkspaceRecentSessions } from '../../lib/api/queries.js';
import { useConfig } from '../../lib/api/queries.js';
import { safeCopyToClipboard } from '../../lib/clipboard.js';
import { cn } from '../../lib/utils.js';
import type { AISession, WorkspaceLaunchIcon, WorkspaceLaunchTarget } from '../../types.js';

const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ICONS: Record<WorkspaceLaunchIcon, React.ComponentType<{ className?: string }>> = {
  codex: BsOpenai,
  claude: SiClaude,
  vscode: VscVscode,
  'vscode-insiders': VscVscodeInsiders,
  cursor: SiCursor,
  antigravity: Orbit,
  powershell: Terminal,
  cmd: Terminal,
  terminal: Terminal,
  intellij: SiIntellijidea,
  webstorm: SiWebstorm,
  pycharm: SiPycharm,
  sublime: SiSublimetext,
  zed: SiZedindustries,
  windsurf: SiWindsurf,
};

const ICON_STYLES: Record<WorkspaceLaunchIcon, string> = {
  codex: 'bg-foreground text-background',
  claude: 'bg-[#D97757] text-white',
  vscode: 'bg-[#007ACC] text-white',
  'vscode-insiders': 'bg-[#24A148] text-white',
  cursor: 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950',
  antigravity: 'bg-violet-600 text-white',
  powershell: 'bg-sky-700 text-white',
  cmd: 'bg-zinc-800 text-amber-400',
  terminal: 'bg-zinc-800 text-emerald-400',
  intellij: 'bg-fuchsia-600 text-white',
  webstorm: 'bg-cyan-600 text-white',
  pycharm: 'bg-lime-600 text-zinc-950',
  sublime: 'bg-orange-500 text-white',
  zed: 'bg-red-600 text-white',
  windsurf: 'bg-teal-600 text-white',
};

function LauncherIcon({ icon }: { icon: WorkspaceLaunchIcon }) {
  const Icon = ICONS[icon] ?? Code2;
  return (
    <span
      className={cn('grid size-10 shrink-0 place-items-center rounded-xl shadow-sm', ICON_STYLES[icon])}
      aria-hidden="true"
    >
      <Icon className="size-5" />
    </span>
  );
}

function TargetButton({
  target,
  busy,
  launching,
  preferred,
  onLaunch,
}: {
  target: WorkspaceLaunchTarget;
  busy: boolean;
  launching: boolean;
  preferred?: boolean;
  onLaunch: (target: WorkspaceLaunchTarget) => void;
}) {
  return (
    <button
      type="button"
      disabled={!target.available || busy}
      onClick={() => onLaunch(target)}
      aria-label={`Open workspace in ${target.name}`}
      className={cn(
        'flex min-h-20 w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'cursor-pointer border-border bg-card hover:border-primary/40 hover:bg-accent/60',
      )}
    >
      <LauncherIcon icon={target.icon} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">{target.name}</span>
          {launching ? (
            <Spinner className="size-4" />
          ) : preferred ? (
            <Badge size="sm" variant="secondary">Preferred</Badge>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {target.description}
        </span>
      </span>
    </button>
  );
}

function RecentSessionButton({
  session,
  busy,
  launching,
  onResume,
}: {
  session: AISession;
  busy: boolean;
  launching: boolean;
  onResume: (session: AISession) => void;
}) {
  const handoff = session.desktopHandoff!;
  const direct = handoff.method === 'direct';
  const appName = direct ? 'Codex Desktop' : 'Claude Desktop';

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onResume(session)}
      aria-label={direct
        ? `Resume ${session.title} in Codex Desktop`
        : `Move ${session.title} to Claude Desktop`}
      className={cn(
        'flex min-h-20 w-full cursor-pointer items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-left outline-none transition-colors',
        'hover:border-primary/45 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-65',
      )}
    >
      <LauncherIcon icon={direct ? 'codex' : 'claude'} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium text-foreground" title={session.title}>{session.title}</span>
          {launching
            ? <Spinner className="size-4 shrink-0" />
            : direct
              ? <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
              : <Copy className="size-4 shrink-0 text-muted-foreground" />}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {direct
            ? `Open this existing task in ${appName}`
            : 'Resume in Claude Code, then type /desktop'}
          {' · '}{new Date(session.updatedAt).toLocaleString()}
        </span>
      </span>
    </button>
  );
}

export function WorkspaceLauncher({
  workspaceId,
  workspacePath,
  isVsCode = false,
  className,
}: {
  workspaceId: string;
  workspacePath: string;
  isVsCode?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const launchInFlight = useRef(false);
  const targets = useWorkspaceLaunchTargets();
  const recentSessions = useWorkspaceRecentSessions(workspaceId, open);
  const config = useConfig().data?.config;

  const availableTargets = targets.data?.filter((target) => target.available) ?? [];
  const aiApps = availableTargets.filter((target) => target.kind === 'ai-app');
  const preferredEditorId = config?.defaultEditor
    ? ({
        code: 'vscode',
        'code-insiders': 'vscode-insiders',
        cursor: 'cursor',
        antigravity: 'antigravity',
        idea: 'intellij',
        webstorm: 'webstorm',
        charm: 'pycharm',
        subl: 'sublime',
        zed: 'zed',
        windsurf: 'windsurf',
      } as Record<string, string>)[config.defaultEditor]
    : undefined;
  const editors = availableTargets.filter((target) => target.kind === 'editor')
    .toSorted((left, right) => Number(right.id === preferredEditorId) - Number(left.id === preferredEditorId));
  const availableTargetIds = new Set(availableTargets.map((target) => target.id));
  const resumableSessions = (recentSessions.data ?? []).filter((session) =>
    session.desktopHandoff && availableTargetIds.has(session.desktopHandoff.targetId));
  const hasLaunchOptions = isVsCode || availableTargets.length > 0;

  const launch = async (target: WorkspaceLaunchTarget) => {
    if (launchInFlight.current) return;
    launchInFlight.current = true;
    setError(null);
    setHandoffNotice(null);
    setLaunchingId(target.id);
    try {
      await apiFetch(`/api/workspace/${encodeURIComponent(workspaceId)}/launch`, {
        method: 'POST',
        body: JSON.stringify({ targetId: target.id }),
      });
      setOpen(false);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : String(launchError));
      await targets.refetch();
    } finally {
      setLaunchingId(null);
      launchInFlight.current = false;
    }
  };

  const resumeSession = async (session: AISession) => {
    if (launchInFlight.current || !session.desktopHandoff || !SESSION_UUID.test(session.id)) return;
    launchInFlight.current = true;
    setError(null);
    setHandoffNotice(null);
    setLaunchingId(`session:${session.id}`);
    try {
      if (session.desktopHandoff.method === 'guided') {
        await safeCopyToClipboard(`claude --resume ${session.id}`);
        setHandoffNotice('Claude resume command copied. With a Claude subscription login, run it in this workspace, then type /desktop in Claude to move the session into Claude Desktop.');
        return;
      }

      await apiFetch(`/api/workspace/${encodeURIComponent(workspaceId)}/launch`, {
        method: 'POST',
        body: JSON.stringify({
          targetId: session.desktopHandoff.targetId,
          action: 'resume',
          sessionId: session.id,
        }),
      });
      setOpen(false);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : String(resumeError));
      await Promise.all([targets.refetch(), recentSessions.refetch()]);
    } finally {
      setLaunchingId(null);
      launchInFlight.current = false;
    }
  };

  const openCurrentVsCode = () => {
    window.parent.postMessage({ type: 'openWorkspaceFolder', workspacePath }, '*');
    setOpen(false);
  };

  const recheck = () => Promise.all([targets.refetch(), recentSessions.refetch()]);
  const isRechecking = targets.isFetching || recentSessions.isFetching;

  return (
    <>
      <Button variant="outline" className={className} onClick={() => setOpen(true)}>
        <Rocket />
        Open with…
      </Button>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setError(null);
          setHandoffNotice(null);
        }
      }}>
        <DialogPopup className="max-w-2xl" aria-busy={launchingId !== null}>
          <DialogHeader>
            <DialogTitle>Open workspace with…</DialogTitle>
            <DialogDescription>
              Continue recent AI work or start in an installed coding app or editor. AI apps may use their own online services.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-5">
            {error && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                {error}
              </div>
            )}
            {handoffNotice && (
              <div role="status" className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-foreground">
                {handoffNotice}
              </div>
            )}

            {recentSessions.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <Spinner className="size-4" /> Checking recent sessions…
              </div>
            ) : resumableSessions.length > 0 ? (
              <section aria-labelledby="recent-sessions-heading">
                <h3 id="recent-sessions-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Continue recent work
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {resumableSessions.map((session) => (
                    <RecentSessionButton
                      key={`${session.assistant}:${session.id}`}
                      session={session}
                      busy={launchingId !== null}
                      launching={launchingId === `session:${session.id}`}
                      onResume={resumeSession}
                    />
                  ))}
                </div>
              </section>
            ) : recentSessions.isError ? (
              <p className="text-xs text-muted-foreground">Recent sessions could not be checked. Starting new work is still available.</p>
            ) : null}

            {isVsCode && (
              <section aria-labelledby="current-editor-heading">
                <h3 id="current-editor-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Current window
                </h3>
                <button
                  type="button"
                  disabled={launchingId !== null}
                  onClick={openCurrentVsCode}
                  className="flex min-h-20 w-full cursor-pointer items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-left outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-65"
                >
                  <LauncherIcon icon="vscode" />
                  <span>
                    <span className="block font-medium">Current VS Code window</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">Open through the installed NexusFlow extension.</span>
                  </span>
                </button>
              </section>
            )}

            {targets.isLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" aria-live="polite">
                <Spinner /> Checking apps on this computer…
              </div>
            ) : targets.isError ? (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-foreground">
                {targets.error instanceof Error ? targets.error.message : 'Could not check available apps.'}
              </div>
            ) : (
              <>
                {aiApps.length > 0 && <section aria-labelledby="ai-apps-heading">
                  <h3 id="ai-apps-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    AI coding apps
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {aiApps.map((target) => (
                      <TargetButton
                        key={target.id}
                        target={target}
                        busy={launchingId !== null}
                        launching={launchingId === target.id}
                        onLaunch={launch}
                      />
                    ))}
                  </div>
                </section>}
                {editors.length > 0 && <section aria-labelledby="editors-heading">
                  <h3 id="editors-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Code editors
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {editors.map((target) => (
                      <TargetButton
                        key={target.id}
                        target={target}
                        busy={launchingId !== null}
                        launching={launchingId === target.id}
                        preferred={target.id === preferredEditorId}
                        onLaunch={launch}
                      />
                    ))}
                  </div>
                </section>}
                {!hasLaunchOptions && (
                  <Empty className="rounded-xl border border-dashed py-8 md:p-8">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><AppWindow /></EmptyMedia>
                      <EmptyTitle className="text-base">No compatible apps detected</EmptyTitle>
                      <EmptyDescription>
                        Install a supported coding app or add its command to PATH, then recheck.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {isRechecking ? 'Checking recent sessions and apps…' : 'Can’t find your app or session? Recheck detection.'}
              </p>
              <Button size="sm" variant="ghost" onClick={() => void recheck()} disabled={isRechecking || launchingId !== null}>
                <RefreshCw className={isRechecking ? 'animate-spin' : ''} />
                Recheck
              </Button>
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
