import React from 'react';
import { Play, Square, AlertTriangle, Terminal, Maximize2, Minimize2, Trash2, Cpu, Activity, RefreshCw } from 'lucide-react';
import type { Feature, ServiceConfig, RunningService, OrchestrationDetection } from '../../types.js';

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
    return isRunning ? 'bg-emerald-500 animate-pulse-glow-green' : 'bg-rose-500';
  };

  const isAnyRunning = runningServices.some((rs) => rs.pid > 0);

  return (
    <div className="animate-fade-in">
      {servicesLoading && (
        <div className="flex items-center gap-2 text-[10px] text-indigo-400 mb-4 animate-pulse">
          <RefreshCw className="animate-spin" size={12} />
          <span className="font-semibold tracking-wider uppercase">Scanning service configurations...</span>
        </div>
      )}
      {orchTools && orchTools.length > 0 && (
        <div className="flex items-center gap-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 mb-5 text-xs text-indigo-300">
          <AlertTriangle size={16} className="text-indigo-400 shrink-0 animate-bounce" />
          <div>
            <strong>Orchestration manifest detected:</strong> {orchTools.map((t) => t.tool).join(', ')}. You can start them inside sub-repos.
          </div>
        </div>
      )}

      {/* Telemetry Dashboard Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* Telemetry 1: CPU */}
        <div className="glass-card p-5 rounded-2xl border border-slate-800/40 relative overflow-hidden transition-all duration-300 before:absolute before:inset-x-0 before:top-0 before:h-[1px] before:bg-gradient-to-r before:from-indigo-500/10 via-purple-500/10 to-transparent">
          <div className="flex justify-between items-center text-xs font-semibold text-slate-400 mb-3">
            <span className="flex items-center gap-1.5"><Cpu size={14} className="text-indigo-400" /> Simulated CPU Load</span>
            <span className={isAnyRunning ? "text-emerald-400 font-mono font-bold" : "text-slate-550 font-mono"}>
              {isAnyRunning ? '4.8%' : '0%'}
            </span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-1.5 mb-2 overflow-hidden border border-white/5">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${isAnyRunning ? "bg-gradient-to-r from-emerald-500 to-teal-400" : "bg-slate-800"}`}
              style={{ width: isAnyRunning ? '48%' : '0%' }}
            ></div>
          </div>
          <span className="text-[10px] text-slate-550">Fluctuating active worker processes</span>
        </div>

        {/* Telemetry 2: Memory */}
        <div className="glass-card p-5 rounded-2xl border border-slate-800/40 relative overflow-hidden transition-all duration-300 before:absolute before:inset-x-0 before:top-0 before:h-[1px] before:bg-gradient-to-r before:from-indigo-500/10 via-purple-500/10 to-transparent">
          <div className="flex justify-between items-center text-xs font-semibold text-slate-400 mb-3">
            <span className="flex items-center gap-1.5"><Activity size={14} className="text-indigo-400" /> Simulated Memory</span>
            <span className={isAnyRunning ? "text-cyan-400 font-mono font-bold" : "text-slate-550 font-mono"}>
              {isAnyRunning ? '192 MB' : '0 MB'}
            </span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-1.5 mb-2 overflow-hidden border border-white/5">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${isAnyRunning ? "bg-gradient-to-r from-cyan-500 to-indigo-400" : "bg-slate-800"}`}
              style={{ width: isAnyRunning ? '65%' : '0%' }}
            ></div>
          </div>
          <span className="text-[10px] text-slate-550">Working set size for spawned servers</span>
        </div>

        {/* Telemetry 3: Environment Health */}
        <div className="glass-card p-5 rounded-2xl border border-slate-800/40 relative overflow-hidden transition-all duration-300 before:absolute before:inset-x-0 before:top-0 before:h-[1px] before:bg-gradient-to-r before:from-indigo-500/10 via-purple-500/10 to-transparent">
          <div className="flex justify-between items-center text-xs font-semibold text-slate-400 mb-3">
            <span>Workspace Status</span>
            <span className={`inline-flex items-center gap-1.5 text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${isAnyRunning ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-slate-500 bg-slate-950/40 border-slate-900"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isAnyRunning ? "bg-emerald-400 animate-ping" : "bg-slate-600"}`}></span>
              {isAnyRunning ? 'Active' : 'Standby'}
            </span>
          </div>
          <div className="text-xs text-white font-semibold mb-2">
            {isAnyRunning ? `${runningServices.filter(rs => rs.pid > 0).length} processes active` : "All processes offline"}
          </div>
          <span className="text-[10px] text-slate-550">Service state mapping</span>
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex gap-3 mb-6">
        <button
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-650 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-emerald-500/10 hover:-translate-y-0.5 active:translate-y-0"
          onClick={() => handleStartServices(ws.branchName)}
          disabled={isAnyRunning}
        >
          <Play size={14} /> Start All Services
        </button>
        <button
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-rose-950/40 border border-rose-900/60 hover:bg-rose-900/60 hover:border-rose-800 text-red-200 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0"
          onClick={() => handleStopServices(ws.branchName)}
          disabled={!isAnyRunning}
        >
          <Square size={14} /> Stop All
        </button>
      </div>

      {/* Split-Pane DevOps Console */}
      {services.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 border border-slate-900 rounded-2xl overflow-hidden shadow-2xl bg-slate-950/40 backdrop-blur-md">
          
          {/* Left Pane: Services List (4 cols) */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-900 p-5 bg-slate-950/60">
            <h4 className="text-[10px] text-slate-450 uppercase font-bold tracking-wider mb-4 flex items-center gap-1.5 border-b border-slate-900 pb-2">
              <Terminal size={12} className="text-indigo-400" /> Background Services
            </h4>
            <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1">
              {services.map((svc) => {
                const isSelected = selectedLogService === svc.name;
                return (
                  <div
                    key={svc.name}
                    className={`flex flex-col p-3 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-indigo-500/10 border-indigo-500/40 text-white shadow-[0_0_15px_rgba(99,102,241,0.05)]'
                        : 'bg-slate-950/30 border-slate-900 hover:border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                    onClick={() => setSelectedLogService(svc.name)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 truncate">
                        <span className={`h-2 w-2 rounded-full ${getStatusColor(svc.name)}`}></span>
                        <span className="font-bold text-xs truncate">{svc.name}</span>
                      </div>
                      {svc.port && (
                        <span className="text-[9px] font-mono px-2 py-0.5 bg-slate-900 border border-slate-850 rounded text-slate-400">
                          Port: {svc.port}
                        </span>
                      )}
                    </div>
                    <code className="text-[9px] font-mono text-slate-500 mt-2 truncate bg-slate-950/50 p-1.5 rounded border border-slate-900/60 block">
                      {svc.command} {svc.args.join(' ')}
                    </code>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Pane: Logs Console (8 cols) */}
          <div className="lg:col-span-8 flex flex-col min-w-0 bg-[#03050a]">
            {/* Console Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-slate-950/80 px-5 py-3 border-b border-slate-900 gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-indigo-400 text-glow-indigo">{selectedLogService || 'no-service'}</span>
                <span className="text-slate-700">|</span>
                <span className="text-[9px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded uppercase font-semibold">stdout_stream</span>
              </div>
              
              <div className="flex items-center gap-3 self-end sm:self-auto">
                {/* Theme Toggle */}
                <div className="flex bg-slate-900 border border-slate-850 p-0.5 rounded-lg text-[9px] font-semibold text-slate-400">
                  {(['classic', 'matrix', 'dracula'] as const).map((t) => (
                    <button
                      key={t}
                      className={`px-2 py-1 rounded-md capitalize cursor-pointer transition-all ${termTheme === t ? 'bg-slate-800 text-white font-bold' : 'hover:text-white'}`}
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
                    className="p-1.5 bg-slate-900 border border-slate-850 text-slate-400 hover:text-white rounded-lg transition-all cursor-pointer"
                    title="Clear Console"
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="p-1.5 bg-slate-900 border border-slate-850 text-slate-400 hover:text-white rounded-lg transition-all cursor-pointer"
                    title={isExpanded ? "Minimize Console" : "Expand Console"}
                  >
                    {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Terminal Body */}
            <div className={`p-5 font-mono text-[10.5px] leading-relaxed overflow-y-auto whitespace-pre-wrap select-text selection:bg-indigo-500/30 transition-all duration-300 relative ${getThemeClass()} ${isExpanded ? 'h-[520px]' : 'h-80'}`}>
              <div className="absolute top-4 right-5 text-[8px] bg-slate-900/60 border border-white/5 text-slate-400/50 px-2.5 py-0.5 rounded-md font-mono select-none uppercase tracking-widest font-bold">
                LIVE LOGGER
              </div>
              {activeLogs.trim() ? (
                activeLogs
              ) : (
                <span className="text-slate-650 italic font-mono">(no log content recorded)</span>
              )}
              <div ref={logsEndRef}></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
