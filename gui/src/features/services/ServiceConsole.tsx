import React from 'react';
import { Play, Square, AlertTriangle } from 'lucide-react';
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
  return (
    <div>
      {servicesLoading && (
        <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-3 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
          <span>Scanning service configurations...</span>
        </div>
      )}
      {orchTools && orchTools.length > 0 && (
        <div className="flex items-center gap-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 mb-4 text-xs text-indigo-300">
          <AlertTriangle size={16} className="text-indigo-400 shrink-0" />
          <div>
            <strong>Orchestration manifest detected:</strong> {orchTools.map((t) => t.tool).join(', ')}. You can start them inside sub-repos.
          </div>
        </div>
      )}
      {/* Telemetry Dashboard Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* Telemetry 1: CPU */}
        <div className="bg-gray-950/40 border border-gray-800/60 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex justify-between items-center text-xs font-semibold text-gray-400 mb-2">
            <span>Simulated CPU Load</span>
            <span className={runningServices.length > 0 ? "text-emerald-400" : "text-gray-500"}>
              {runningServices.length > 0 ? '4.8%' : '0%'}
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5 mb-2 overflow-hidden">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${runningServices.length > 0 ? "bg-gradient-to-r from-emerald-500 to-teal-400 animate-pulse" : "bg-gray-700"}`}
              style={{ width: runningServices.length > 0 ? '48%' : '0%' }}
            ></div>
          </div>
          <span className="text-[10px] text-gray-500">Fluctuating active worker processes</span>
        </div>

        {/* Telemetry 2: Memory */}
        <div className="bg-gray-950/40 border border-gray-800/60 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex justify-between items-center text-xs font-semibold text-gray-400 mb-2">
            <span>Simulated Memory Allocation</span>
            <span className={runningServices.length > 0 ? "text-cyan-400" : "text-gray-500"}>
              {runningServices.length > 0 ? '192 MB' : '0 MB'}
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5 mb-2 overflow-hidden">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${runningServices.length > 0 ? "bg-gradient-to-r from-cyan-500 to-indigo-400" : "bg-gray-700"}`}
              style={{ width: runningServices.length > 0 ? '65%' : '0%' }}
            ></div>
          </div>
          <span className="text-[10px] text-gray-500">Working set size for spawned servers</span>
        </div>

        {/* Telemetry 3: Environment Health */}
        <div className="bg-gray-950/40 border border-gray-800/60 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex justify-between items-center text-xs font-semibold text-gray-400 mb-2">
            <span>Active Workspace Status</span>
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider ${runningServices.length > 0 ? "text-emerald-400" : "text-gray-500"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${runningServices.length > 0 ? "bg-emerald-500 animate-ping" : "bg-gray-600"}`}></span>
              {runningServices.length > 0 ? 'HEALTHY (ONLINE)' : 'STANDBY (OFFLINE)'}
            </span>
          </div>
          <div className="text-xs text-white font-medium truncate">
            {runningServices.length > 0 ? `${runningServices.length} processes active` : "All processes offline"}
          </div>
          <span className="text-[10px] text-gray-500">Service state mapping</span>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-emerald-500/10 hover:-translate-y-0.5 active:translate-y-0"
          onClick={() => handleStartServices(ws.branchName)}
          disabled={runningServices.length > 0}
        >
          <Play size={14} /> Start All Services
        </button>
        <button
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-rose-600/10 hover:-translate-y-0.5 active:translate-y-0"
          onClick={() => handleStopServices(ws.branchName)}
          disabled={runningServices.length === 0}
        >
          <Square size={14} /> Stop All
        </button>
      </div>

      {/* Interactive Console Screen */}
      {services.length > 0 && (
        <div className="border border-gray-800/80 rounded-xl overflow-hidden shadow-2xl bg-gray-950/60">
          {/* Terminal Window Header */}
          <div className="flex items-center justify-between bg-gray-900/80 px-4 py-3 border-b border-gray-800/60">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-rose-500/20 border border-rose-500/30"></span>
                <span className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/30"></span>
                <span className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/30"></span>
              </div>
              <span className="text-[11px] font-mono text-gray-400 font-semibold ml-2">nexusflow-terminal: {selectedLogService}</span>
            </div>
            <div className="flex gap-1 bg-gray-950/40 p-1 rounded-lg border border-gray-800/60">
              {services.map((svc) => (
                <button
                  key={svc.name}
                  className={`px-3 py-1 rounded-md text-[10px] font-mono font-bold transition-all cursor-pointer ${
                    selectedLogService === svc.name
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                  onClick={() => setSelectedLogService(svc.name)}
                >
                  {svc.name}
                </button>
              ))}
            </div>
          </div>

          {/* Terminal Screen Body */}
          <div className="bg-[#030408] p-5 font-mono text-[11px] text-cyan-400/90 h-80 overflow-y-auto whitespace-pre-wrap shadow-inner relative scrollbar-thin scrollbar-thumb-gray-800">
            <div className="absolute top-3 right-3 text-[9px] bg-slate-900/60 border border-gray-800 text-cyan-500/60 px-2 py-0.5 rounded font-mono select-none uppercase tracking-wider">
              LIVE LOGS
            </div>
            {serviceLogs}
            <div ref={logsEndRef}></div>
          </div>
        </div>
      )}
    </div>
  );
};
