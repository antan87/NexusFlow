import { useState } from 'react';
import {
  Code2,
  Orbit,
  RefreshCw,
  Rocket,
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

import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Spinner } from '../../components/ui/spinner.js';
import { apiFetch } from '../../lib/api/client.js';
import { useWorkspaceLaunchTargets } from '../../lib/api/queries.js';
import { useConfig } from '../../lib/api/queries.js';
import { cn } from '../../lib/utils.js';
import type { WorkspaceLaunchIcon, WorkspaceLaunchTarget } from '../../types.js';

const ICONS: Record<WorkspaceLaunchIcon, React.ComponentType<{ className?: string }>> = {
  codex: BsOpenai,
  claude: SiClaude,
  vscode: VscVscode,
  'vscode-insiders': VscVscodeInsiders,
  cursor: SiCursor,
  antigravity: Orbit,
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
      aria-label={target.available ? `Open workspace in ${target.name}` : `${target.name} unavailable`}
      className={cn(
        'flex min-h-20 w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        target.available
          ? 'cursor-pointer border-border bg-card hover:border-primary/40 hover:bg-accent/60'
          : 'cursor-not-allowed border-border/70 bg-muted/40 opacity-65',
      )}
    >
      <LauncherIcon icon={target.icon} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">{target.name}</span>
          {launching ? (
            <Spinner className="size-4" />
          ) : (
            <span className={cn('text-[11px]', target.available ? 'text-success-foreground' : 'text-muted-foreground')}>
              {target.available ? (preferred ? 'Preferred · Available' : 'Available') : 'Not detected'}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {target.available ? target.description : target.unavailableReason}
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
  const targets = useWorkspaceLaunchTargets();
  const config = useConfig().data?.config;

  const aiApps = targets.data?.filter((target) => target.kind === 'ai-app') ?? [];
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
  const editors = (targets.data?.filter((target) => target.kind === 'editor') ?? [])
    .toSorted((left, right) => Number(right.id === preferredEditorId) - Number(left.id === preferredEditorId));

  const launch = async (target: WorkspaceLaunchTarget) => {
    setError(null);
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
    }
  };

  const openCurrentVsCode = () => {
    window.parent.postMessage({ type: 'openWorkspaceFolder', workspacePath }, '*');
    setOpen(false);
  };

  return (
    <>
      <Button variant="outline" className={className} onClick={() => setOpen(true)}>
        <Rocket />
        Open with…
      </Button>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setError(null);
      }}>
        <DialogPopup className="max-w-2xl" aria-busy={launchingId !== null}>
          <DialogHeader>
            <DialogTitle>Open workspace with…</DialogTitle>
            <DialogDescription>
              Choose a local coding app or editor. AI apps receive the workspace path and an editable task kickoff; they may use their own online services.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-5">
            {error && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                {error}
              </div>
            )}

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
                <section aria-labelledby="ai-apps-heading">
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
                </section>
                <section aria-labelledby="editors-heading">
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
                </section>
              </>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={workspacePath}>{workspacePath}</p>
              <Button size="sm" variant="ghost" onClick={() => void targets.refetch()} disabled={targets.isFetching || launchingId !== null}>
                <RefreshCw className={targets.isFetching ? 'animate-spin' : ''} />
                Recheck
              </Button>
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
