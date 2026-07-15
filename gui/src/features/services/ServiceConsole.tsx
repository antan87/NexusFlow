import React from 'react';
import { Play, Square, AlertTriangle, Terminal, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import type { Feature, ServiceConfig, RunningService, OrchestrationDetection } from '../../types.js';
import { Button } from '../../components/ui/button.js';
import { Spinner } from '../../components/ui/spinner.js';
import { StatusBadge } from '../../components/ui/status-badge.js';
import { cn } from '../../lib/utils.js';

interface ServiceConsoleProps {
  ws: Feature;
  services: ServiceConfig[];
  runningServices: RunningService[];
  selectedLogService: string | null;
  serviceLogs: string;
  logsEndRef: React.RefObject<HTMLDivElement | null>;
  setSelectedLogService: (val: string | null) => void;
  handleStartServices: (wsId: string) => Promise<void>;
  handleStopServices: (wsId: string) => Promise<void>;
  orchTools: OrchestrationDetection[];
  servicesLoading: boolean;
}

export const ServiceConsole: React.FC<ServiceConsoleProps> = ({
  ws,
  services,
  runningServices,
  selectedLogService,
  serviceLogs,
  logsEndRef,
  setSelectedLogService,
  handleStartServices,
  handleStopServices,
  orchTools,
  servicesLoading,
}) => {
  const [termTheme, setTermTheme] = React.useState<'classic' | 'matrix' | 'dracula'>('classic');
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [clearedLogsLength, setClearedLogsLength] = React.useState<Record<string, number>>({});

  const handleClearLogs = () => {
    if (selectedLogService) {
      setClearedLogsLength((prev) => ({ ...prev, [selectedLogService]: serviceLogs.length }));
    }
  };

  const isCleared = selectedLogService ? (clearedLogsLength[selectedLogService] === serviceLogs.length) : false;
  const activeLogs = selectedLogService && isCleared ? '' : serviceLogs;

  const getThemeClass = () => {
    switch (termTheme) {
      case 'matrix': return 'term-matrix';
      case 'dracula': return 'term-dracula';
      default: return 'term-classic';
    }
  };

  const getStatusColor = (name: string) => {
    const isRunning = runningServices.some((rs) => rs.name === name && rs.pid > 0);
    return isRunning ? 'bg-success' : 'bg-destructive';
  };

  const isAnyRunning = runningServices.some((rs) => rs.pid > 0);

  return (
    <div className="animate-fade-in">
      {servicesLoading && (
        <div className="mb-4 flex items-center gap-2 text-[10px] text-primary">
          <Spinner className="size-3" />
          <span className="font-semibold tracking-wider uppercase">Scanning service configurations...</span>
        </div>
      )}
      {orchTools && orchTools.length > 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-info/25 bg-info/10 p-4 text-xs text-info-foreground">
          <AlertTriangle size={16} className="shrink-0 text-info" />
          <div>
            <strong>Orchestration manifest detected:</strong> {orchTools.map((t) => t.tool).join(', ')}. You can start them inside sub-repos.
          </div>
        </div>
      )}

      {/* Workspace service status (real running-process state) */}
      <div className="mb-6">
        <div className="rounded-xl border border-border bg-card p-5 transition-colors">
          <div className="mb-3 flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Workspace Status</span>
            <StatusBadge tone={isAnyRunning ? 'running' : 'idle'}>{isAnyRunning ? 'Active' : 'Standby'}</StatusBadge>
          </div>
          <div className="mb-2 text-xs font-semibold text-foreground">
            {isAnyRunning ? `${runningServices.filter(rs => rs.pid > 0).length} processes active` : "All processes offline"}
          </div>
          <span className="text-[10px] text-muted-foreground">Live service state for this workspace</span>
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex gap-3 mb-6">
        <Button
          onClick={() => handleStartServices(ws.branchName)}
          disabled={isAnyRunning}
        >
          <Play size={14} /> Start All Services
        </Button>
        <Button
          variant="destructive"
          onClick={() => handleStopServices(ws.branchName)}
          disabled={!isAnyRunning}
        >
          <Square size={14} /> Stop All
        </Button>
      </div>

      {/* Split-Pane DevOps Console */}
      {services.length > 0 && (
        <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:grid-cols-12">
          
          {/* Left Pane: Services List (4 cols) */}
          <div className="border-b border-border bg-muted/30 p-5 lg:col-span-4 lg:border-b-0 lg:border-r">
            <h4 className="mb-4 flex items-center gap-1.5 border-b border-border pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <Terminal size={12} className="text-primary" /> Background Services
            </h4>
            <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1">
              {services.map((svc) => {
                const isSelected = selectedLogService === svc.name;
                return (
                  <div
                    key={svc.name}
                    className={`flex cursor-pointer flex-col rounded-xl border p-3 transition-colors ${
                      isSelected
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:border-foreground/15 hover:bg-accent/50 hover:text-foreground'
                    }`}
                    onClick={() => setSelectedLogService(svc.name)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 truncate">
                        <span className={`h-2 w-2 rounded-full ${getStatusColor(svc.name)}`}></span>
                        <span className="font-bold text-xs truncate">{svc.name}</span>
                      </div>
                      {svc.port && (
                        <span className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
                          Port: {svc.port}
                        </span>
                      )}
                    </div>
                    <code className="mt-2 block truncate rounded border border-border bg-muted/40 p-1.5 font-mono text-[9px] text-muted-foreground">
                      {svc.command} {svc.args.join(' ')}
                    </code>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Pane: Logs Console (8 cols) */}
          <div className="flex min-w-0 flex-col bg-background lg:col-span-8">
            {/* Console Header */}
            <div className="flex flex-col gap-3 border-b border-border bg-muted/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-primary">{selectedLogService || 'no-service'}</span>
                <span className="text-muted-foreground">|</span>
                <span className="rounded border border-info/25 bg-info/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase text-info-foreground">stdout_stream</span>
              </div>
               
              <div className="flex items-center gap-3 self-end sm:self-auto">
                {/* Theme Toggle */}
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

                {/* Operations */}
                <div className="flex gap-1.5">
                  <button
                    onClick={handleClearLogs}
                    className="cursor-pointer rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title="Clear Console"
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="cursor-pointer rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    title={isExpanded ? "Minimize Console" : "Expand Console"}
                  >
                    {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Terminal Body */}
            <div className={`relative overflow-y-auto whitespace-pre-wrap p-5 font-mono text-[10.5px] leading-relaxed selection:bg-primary/20 ${getThemeClass()} ${isExpanded ? 'h-[520px]' : 'h-80'}`}>
              <div className="absolute right-5 top-4 select-none rounded-md border border-border bg-card/80 px-2.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
                LIVE LOGGER
              </div>
              {activeLogs.trim() ? (
                activeLogs
              ) : (
                <span className="font-mono italic text-muted-foreground">(no log content recorded)</span>
              )}
              <div ref={logsEndRef}></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
