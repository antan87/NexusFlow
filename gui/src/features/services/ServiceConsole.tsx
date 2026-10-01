import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, RotateCw, AlertTriangle, Terminal, Maximize2, Minimize2, Trash2, Copy, RefreshCw } from 'lucide-react';
import type { Feature } from '../../types.js';
import { Button } from '../../components/ui/button.js';
import { Spinner } from '../../components/ui/spinner.js';
import { StatusBadge } from '../../components/ui/status-badge.js';
import { cn } from '../../lib/utils.js';
import { useOrchestratorAction, useServiceAction, useWorkspaceServices } from '../../lib/api/queries.js';
import { useServiceLogStream } from './useServiceLogStream.js';
import { safeCopyToClipboard } from '../../lib/clipboard.js';

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
  // Start All runs only what the repositories declare; guesses start one at a time.
  const declared = useMemo(() => services.filter((s) => s.declared), [services]);
  const guessedCount = services.length - declared.length;
  const suggestions = data?.suggestions ?? [];
  const failures = useMemo(() => new Map((data?.failures ?? []).map((f) => [f.name, f.reason])), [data]);
  const [copied, setCopied] = useState<string | null>(null);
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

      {servicesQuery.isError && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} />
            <span>Failed to load services: {servicesQuery.error?.message || 'Unknown error'}</span>
          </div>
          <Button size="xs" variant="outline" onClick={() => servicesQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {(serviceAction.isError || orchestratorAction.isError) && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} />
            <span>
              Action failed: {serviceAction.error?.message || orchestratorAction.error?.message || 'Operation failed'}
            </span>
          </div>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              serviceAction.reset();
              orchestratorAction.reset();
            }}
          >
            Dismiss
          </Button>
        </div>
      )}

      {!servicesQuery.isLoading && !servicesQuery.isError && declared.length === 0 && (
        <section aria-labelledby="declare-services-heading" className="mb-4 rounded-md border border-border/80 bg-card p-4 surface-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 id="declare-services-heading" className="flex items-center gap-2 text-xs font-bold text-foreground">
                <Terminal size={14} className="text-muted-foreground" />
                {services.length ? 'No declared services' : 'No services found'}
              </h4>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Start All runs the processes a repository declares in a <code className="font-mono text-[10px]">Procfile.dev</code> at its root, one <code className="font-mono text-[10px]">name: command</code> per line.{' '}
                {guessedCount > 0
                  ? `${guessedCount} service${guessedCount === 1 ? ' was' : 's were'} guessed from project files; start ${guessedCount === 1 ? 'it' : 'them'} one at a time below, or review this suggestion, keep only processes that should run while you work, and save it.`
                  : 'Add one, then rescan.'}
              </p>
            </div>
            <Button size="xs" variant="outline" disabled={servicesQuery.isFetching} onClick={() => void servicesQuery.refetch()}>
              <RefreshCw size={12} /> Rescan
            </Button>
          </div>
          {(suggestions.length ? suggestions : [{ file: 'Procfile.dev', content: 'web: npm run dev\n' }]).map((suggestion) => (
            <div key={suggestion.file} className="mt-3 rounded-md border border-border/60 bg-muted/30">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1">
                <code className="truncate font-mono text-[10px] text-muted-foreground" title={suggestion.file}>{suggestion.file}</code>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Copy suggested ${suggestion.file}`}
                  onClick={() => void safeCopyToClipboard(suggestion.content).then((ok) => setCopied(ok ? suggestion.file : null))}
                >
                  <Copy size={12} /> {copied === suggestion.file ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre className="overflow-x-auto p-2 font-mono text-[10px] text-foreground">{suggestion.content}</pre>
            </div>
          ))}
        </section>
      )}

      {/* Orchestration tools — actionable rows. */}
      {orchTools.length > 0 && (
        <div className="mb-4 rounded-md border border-border/80 bg-card p-4 surface-card">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <AlertTriangle size={12} className="text-info" /> Orchestration tools
          </div>
          <div className="flex flex-col gap-2">
            {orchTools.map((tool) => {
              const running = runningOrchIds.has(tool.id);
              return (
                <div key={tool.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
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
      <div className="mb-4 rounded-md border border-border/80 bg-card p-4 surface-card">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span>Workspace Status</span>
          <StatusBadge tone={isAnyRunning ? 'running' : 'idle'}>{isAnyRunning ? 'Active' : 'Standby'}</StatusBadge>
        </div>
        <div className="mb-3 text-xs font-semibold text-foreground">
          {isAnyRunning ? `${runningNames.size} process${runningNames.size === 1 ? '' : 'es'} active` : 'All processes offline'}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={declared.length === 0 || isAnyRunning || pending}
            title={declared.length === 0 ? 'Nothing is declared yet. Add a Procfile.dev, or start a guessed service on its own.' : undefined}
            onClick={() => serviceAction.mutate({ action: 'start' })}
          >
            <Play size={13} /> Start declared services
          </Button>
          <Button size="sm" variant="destructive" disabled={!isAnyRunning || pending} onClick={() => serviceAction.mutate({ action: 'stop' })}>
            <Square size={13} /> Stop All
          </Button>
        </div>
      </div>

      {/* Split-pane console. */}
      {(services.length > 0 || orchLogs.length > 0) && (
        <div className="grid grid-cols-1 overflow-hidden rounded-md border border-border/80 bg-card shadow-xs lg:grid-cols-12 surface-card">
          {/* Service list with per-row controls. */}
          <div className="border-b border-border/80 bg-muted/20 p-4 lg:col-span-4 lg:border-b-0 lg:border-r">
            <h4 className="mb-4 flex items-center gap-1.5 border-b border-border pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <Terminal size={12} className="text-primary" /> Background Services
            </h4>
            <div className="flex max-h-[400px] flex-col gap-2 overflow-y-auto pr-1">
              {services.map((svc) => {
                const isSelected = selectedLogService === svc.name;
                const running = runningNames.has(svc.name);
                const failure = running ? undefined : failures.get(svc.name);
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
                        <span className={`h-2 w-2 shrink-0 rounded-full ${running ? 'bg-success' : failure ? 'bg-destructive' : 'bg-muted-foreground/40'}`} />
                        <span className="truncate text-xs font-bold">{svc.name}</span>
                        <span className="sr-only">{running ? ', running' : failure ? ', not started' : ', stopped'}</span>
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
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {svc.declared ? (
                        <StatusBadge tone="success" dot={false} title="Declared by the repository">
                          {svc.declaredIn ? `${svc.declaredIn.file}:${svc.declaredIn.line}` : 'Declared'}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="warning" dot={false} title="Guessed from project files; Start All does not run it">
                          Guessed from {svc.source}
                        </StatusBadge>
                      )}
                      {svc.port ? (
                        <span className="w-fit rounded border border-border bg-background px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
                          Port: {svc.port}
                        </span>
                      ) : null}
                    </div>
                    <code className="mt-2 block truncate rounded border border-border bg-muted/40 p-1.5 font-mono text-[9px] text-muted-foreground" title={svc.cwd}>
                      {svc.display ?? `${svc.command} ${svc.args.join(' ')}`}
                    </code>
                    {failure && (
                      <p className="mt-2 break-words text-[10px] text-destructive" data-testid="service-failure">
                        {failure}
                      </p>
                    )}
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
