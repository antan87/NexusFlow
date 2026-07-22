import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, RotateCw, AlertTriangle, Terminal, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import type { Feature } from '../../types.js';
import { Button } from '../../components/ui/button.js';
import { Spinner } from '../../components/ui/spinner.js';
import { StatusBadge } from '../../components/ui/status-badge.js';
import { cn } from '../../lib/utils.js';
import { useOrchestratorAction, useServiceAction, useWorkspaceServices } from '../../lib/api/queries.js';
import { useServiceLogStream } from './useServiceLogStream.js';

export function ServiceConsole({ ws }: { ws: Feature }) {
  const wsId = ws.branchName;
  const servicesQuery = useWorkspaceServices(wsId);
  const serviceAction = useServiceAction(wsId);
  const orchestratorAction = useOrchestratorAction(wsId);

  const data = servicesQuery.data;
  const services = useMemo(() => data?.services ?? [], [data]);
  const runningServices = useMemo(() => data?.runningState ?? [], [data]);
  const orchTools = data?.orchestrationTools ?? [];
  const runningOrchestrators = useMemo(() => data?.runningOrchestrators ?? [], [data]);
  // pm2-mode orchestrators expose a tailable log source (the server-assigned
  // `logName`); one-shot tools (compose up -d) have no streamable log.
  const orchLogs = useMemo(
    () => runningOrchestrators.filter((o) => o.mode === 'pm2' && o.logName),
    [runningOrchestrators],
  );

  const [termTheme, setTermTheme] = useState<'classic' | 'matrix' | 'dracula'>('classic');
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedLogService, setSelectedLogService] = useState<string | null>(null);

  // Keep a valid log selection as the detected set changes.
  useEffect(() => {
    const logSources = [
      ...services.map((s) => s.name),
      ...orchLogs.map((o) => o.logName as string),
    ];
    if (logSources.length === 0) {
      if (selectedLogService !== null) setSelectedLogService(null);
    } else if (!selectedLogService || !logSources.includes(selectedLogService)) {
      setSelectedLogService(logSources[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, orchLogs]);

  const { logs, connected, clear } = useServiceLogStream(wsId, selectedLogService, true);

  // Auto-scroll to the bottom as logs stream in.
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const runningNames = useMemo(
    () => new Set(runningServices.filter((rs) => rs.pid > 0).map((rs) => rs.name)),
    [runningServices],
  );
  const runningOrchIds = useMemo(
    () => new Set(runningOrchestrators.map((o) => o.id)),
    [runningOrchestrators],
  );

  const isAnyRunning = runningNames.size > 0;
  const themeClass = termTheme === 'matrix' ? 'term-matrix' : termTheme === 'dracula' ? 'term-dracula' : 'term-classic';
  const pending = serviceAction.isPending || orchestratorAction.isPending;

  return (
    <div className="animate-fade-in">
      {servicesQuery.isLoading && (
        <div className="mb-4 flex items-center gap-2 text-[10px] text-primary">
          <Spinner className="size-3" />
          <span className="font-semibold tracking-wider uppercase">Scanning service configurations...</span>
        </div>
      )}

      {/* Orchestration tools — actionable rows. */}
      {orchTools.length > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <AlertTriangle size={12} className="text-info" /> Orchestration tools
          </div>
          <div className="flex flex-col gap-2">
            {orchTools.map((tool) => {
              const running = runningOrchIds.has(tool.id);
              return (
                <div key={tool.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${running ? 'bg-success' : 'bg-muted-foreground/40'}`} />
                      <span className="text-xs font-bold text-foreground">{tool.tool}</span>
                      <StatusBadge tone="idle" dot={false}>{tool.mode}</StatusBadge>
                    </div>
                    <code className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">{tool.configPath}</code>
                  </div>
                  <div className="shrink-0">
                    {running ? (
                      <Button
                        size="xs"
                        variant="destructive"
                        aria-label={`Stop ${tool.tool}`}
                        disabled={pending}
                        onClick={() => orchestratorAction.mutate({ action: 'stop', id: tool.id })}
                      >
                        <Square size={12} /> Stop
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        aria-label={`Start ${tool.tool}`}
                        disabled={pending}
                        onClick={() => orchestratorAction.mutate({ action: 'start', id: tool.id })}
                      >
                        <Play size={12} /> Start
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Workspace status + bulk controls. */}
      <div className="mb-6 rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span>Workspace Status</span>
          <StatusBadge tone={isAnyRunning ? 'running' : 'idle'}>{isAnyRunning ? 'Active' : 'Standby'}</StatusBadge>
        </div>
        <div className="mb-4 text-xs font-semibold text-foreground">
          {isAnyRunning ? `${runningNames.size} process${runningNames.size === 1 ? '' : 'es'} active` : 'All processes offline'}
        </div>
        <div className="flex gap-3">
          <Button disabled={isAnyRunning || pending} onClick={() => serviceAction.mutate({ action: 'start' })}>
            <Play size={14} /> Start All Services
          </Button>
          <Button variant="destructive" disabled={!isAnyRunning || pending} onClick={() => serviceAction.mutate({ action: 'stop' })}>
            <Square size={14} /> Stop All
          </Button>
        </div>
      </div>

      {/* Split-pane console. */}
      {(services.length > 0 || orchLogs.length > 0) && (
        <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:grid-cols-12">
          {/* Service list with per-row controls. */}
          <div className="border-b border-border bg-muted/30 p-5 lg:col-span-4 lg:border-b-0 lg:border-r">
            <h4 className="mb-4 flex items-center gap-1.5 border-b border-border pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <Terminal size={12} className="text-primary" /> Background Services
            </h4>
            <div className="flex max-h-[400px] flex-col gap-2 overflow-y-auto pr-1">
              {services.map((svc) => {
                const isSelected = selectedLogService === svc.name;
                const running = runningNames.has(svc.name);
                return (
                  <div
                    key={svc.name}
                    className={cn(
                      'flex cursor-pointer flex-col rounded-xl border p-3 transition-colors',
                      isSelected
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:border-foreground/15 hover:bg-accent/50 hover:text-foreground',
                    )}
                    onClick={() => setSelectedLogService(svc.name)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${running ? 'bg-success' : 'bg-destructive'}`} />
                        <span className="truncate text-xs font-bold">{svc.name}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {running ? (
                          <>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Restart ${svc.name}`}
                              disabled={pending}
                              onClick={() => serviceAction.mutate({ action: 'restart', service: svc.name })}
                            >
                              <RotateCw />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Stop ${svc.name}`}
                              disabled={pending}
                              onClick={() => serviceAction.mutate({ action: 'stop', service: svc.name })}
                            >
                              <Square />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Start ${svc.name}`}
                            disabled={pending}
                            onClick={() => serviceAction.mutate({ action: 'start', service: svc.name })}
                          >
                            <Play />
                          </Button>
                        )}
                      </div>
                    </div>
                    {svc.port ? (
                      <span className="mt-2 w-fit rounded border border-border bg-background px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
                        Port: {svc.port}
                      </span>
                    ) : null}
                    <code className="mt-2 block truncate rounded border border-border bg-muted/40 p-1.5 font-mono text-[9px] text-muted-foreground">
                      {svc.command} {svc.args.join(' ')}
                    </code>
                  </div>
                );
              })}

              {orchLogs.length > 0 && (
                <>
                  <div className="mt-2 border-t border-border pt-3 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    Orchestrators
                  </div>
                  {orchLogs.map((orch) => {
                    const logName = orch.logName as string;
                    const isSelected = selectedLogService === logName;
                    return (
                      <div
                        key={orch.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-xl border p-3 transition-colors',
                          isSelected
                            ? 'border-primary/40 bg-primary/10 text-foreground'
                            : 'border-border bg-card text-muted-foreground hover:border-foreground/15 hover:bg-accent/50 hover:text-foreground',
                        )}
                        onClick={() => setSelectedLogService(logName)}
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
                        <span className="truncate text-xs font-bold">{orch.tool}</span>
                        <StatusBadge tone="idle" dot={false}>{orch.mode}</StatusBadge>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          {/* Log console. */}
          <div className="flex min-w-0 flex-col bg-background lg:col-span-8">
            <div className="flex flex-col gap-3 border-b border-border bg-muted/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-primary">{selectedLogService || 'no-service'}</span>
                <span className="text-muted-foreground">|</span>
                <StatusBadge tone={connected ? 'running' : 'idle'}>{connected ? 'streaming' : 'idle'}</StatusBadge>
              </div>
              <div className="flex items-center gap-3 self-end sm:self-auto">
                <div className="flex rounded-lg border border-border bg-card p-0.5 text-[9px] font-semibold text-muted-foreground">
                  {(['classic', 'matrix', 'dracula'] as const).map((t) => (
                    <button
                      key={t}
                      className={cn(
                        'cursor-pointer rounded-md px-2 py-1 capitalize transition-colors',
                        termTheme === t ? 'bg-primary/10 font-bold text-primary' : 'hover:text-foreground',
                      )}
                      onClick={() => setTermTheme(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={clear}
                    className="cursor-pointer rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Clear Console"
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="cursor-pointer rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={isExpanded ? 'Minimize Console' : 'Expand Console'}
                  >
                    {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                  </button>
                </div>
              </div>
            </div>

            <div className={cn('relative overflow-y-auto whitespace-pre-wrap p-5 font-mono text-[10.5px] leading-relaxed selection:bg-primary/20', themeClass, isExpanded ? 'h-[520px]' : 'h-80')}>
              {logs.trim() ? logs : <span className="font-mono italic text-muted-foreground">(no log content yet)</span>}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
